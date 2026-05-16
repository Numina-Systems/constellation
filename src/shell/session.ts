// pattern: Imperative Shell

import { stripAnsi } from './ansi';
import { truncateOutput } from './truncate';
import type { ShellConfig, ShellSession, ShellResult } from './types';
import { ShellError } from '@/errors/shell.ts';

const DEFAULT_CONFIG: ShellConfig = {
  shell: '/bin/bash',
  commandTimeout: 30_000,
  idleTimeout: 10 * 60 * 1000,
  maxOutputBytes: 64 * 1024,
  promptMarker: '___CSML___',
};

function resolveConfig(partial?: Partial<ShellConfig>): ShellConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

export async function createShellSession(
  partial?: Partial<ShellConfig>,
): Promise<ShellSession> {
  const getuid = process.getuid;
  if (getuid?.() === 0) {
    throw new ShellError('SHELL_CREATION_FAILED', 'cannot create shell session as root user', {
      uid: process.getuid?.(),
    });
  }

  const config = resolveConfig(partial);
  const { shell, idleTimeout, commandTimeout, maxOutputBytes, promptMarker } =
    config;

  let outputBuffer = '';
  let onData: (() => void) | null = null;
  const decoder = new TextDecoder('utf-8', { fatal: false });

  let proc: ReturnType<typeof Bun.spawn>;
  try {
    proc = Bun.spawn([shell, '--norc', '--noprofile', '-i'], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          outputBuffer += decoder.decode(data, { stream: true });
          onData?.();
        },
      },
    });
  } catch (err) {
    throw new ShellError('SHELL_CREATION_FAILED', `failed to spawn shell: ${err instanceof Error ? err.message : String(err)}`, {
      shell,
    }, { cause: err instanceof Error ? err : undefined });
  }

  let isAliveFlag = true;
  let currentWorkingDirectory = process.cwd();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const markerRegex = new RegExp(
    `\\[${promptMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\]> `,
  );

  function waitForMarker(startIndex: number, timeoutMs: number): Promise<{ match: RegExpExecArray; output: string } | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        onData = null;
        resolve(null);
      }, timeoutMs);

      const check = () => {
        const segment = outputBuffer.substring(startIndex);
        const m = markerRegex.exec(segment);
        if (m) {
          clearTimeout(timer);
          onData = null;
          resolve({ match: m, output: segment });
        }
      };

      onData = check;
      check();
    });
  }

  function resetIdleTimer(): void {
    if (idleTimer !== null) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => void destroy(), idleTimeout);
  }

  // Initialize: set PS1 to our marker format and wait for first prompt
  proc.terminal!.write(`PS1="[${promptMarker}\\$?]> "\n`);

  const initResult = await waitForMarker(0, 5000);
  if (!initResult) {
    proc.kill('SIGKILL');
    throw new ShellError('SHELL_CREATION_FAILED', 'shell initialization timed out waiting for prompt marker', {
      timeoutMs: 5000,
    });
  }

  resetIdleTimer();

  async function execute(command: string): Promise<ShellResult> {
    if (!isAliveFlag) {
      throw new ShellError('SESSION_CLOSED', 'cannot execute command on closed shell session');
    }

    resetIdleTimer();
    outputBuffer = '';
    const outputStartIndex = 0;
    // Wrap: run command, save exit code, emit cwd, restore exit code for PS1's \$?
    proc.terminal!.write(`${command}; __x=$?; echo "___CWD___ $(pwd) ___CWD___"; (exit $__x)\n`);

    // Wait for marker (command completion)
    const result = await waitForMarker(outputStartIndex, commandTimeout);

    if (result) {
      return buildResult(result.match, result.output, command, false);
    }

    // Timeout — send Ctrl+C via terminal (SIGINT to foreground process group)
    proc.terminal!.write('\x03');

    // Grace period: wait for marker after interrupt
    const graceResult = await waitForMarker(outputStartIndex, 2000);

    if (graceResult) {
      return buildResult(graceResult.match, graceResult.output, command, true);
    }

    // SIGKILL escalation — process ignored interrupt
    proc.kill('SIGKILL');
    isAliveFlag = false;

    const partialOutput = cleanOutput(
      outputBuffer.substring(outputStartIndex),
      command,
    );
    return {
      output: `${partialOutput}\n[timeout after ${commandTimeout / 1000}s]`,
      exitCode: null,
      workingDirectory: currentWorkingDirectory,
      timedOut: true,
    };
  }

  function buildResult(
    match: RegExpExecArray,
    segment: string,
    command: string,
    timedOut: boolean,
  ): ShellResult {
    const exitCode = parseInt(match[1] ?? '0', 10);
    const rawBeforeMarker = segment.substring(0, match.index);
    let output = cleanOutput(rawBeforeMarker, command);

    if (timedOut) {
      output += `\n[timeout after ${commandTimeout / 1000}s]`;
    }

    output = truncateOutput(output, maxOutputBytes);

    return { output, exitCode, workingDirectory: currentWorkingDirectory, timedOut };
  }

  const cwdPattern = /___CWD___ (.+?) ___CWD___/;

  function cleanOutput(raw: string, command: string): string {
    const text = stripAnsi(raw);
    const lines = text.split('\n');
    const cleaned: Array<string> = [];
    const wrappedCommand = `${command}; __x=$?; echo "___CWD___ $(pwd) ___CWD___"; (exit $__x)`;

    for (const line of lines) {
      const trimmed = line.trim();
      // Extract cwd from our injected echo
      const cwdMatch = cwdPattern.exec(trimmed);
      if (cwdMatch) {
        currentWorkingDirectory = cwdMatch[1] ?? currentWorkingDirectory;
        continue;
      }
      if (trimmed === command || trimmed === wrappedCommand) continue;
      if (trimmed === '' || /^[%#$>]\s*$/.test(trimmed)) continue;
      if (markerRegex.test(trimmed)) continue;
      cleaned.push(line);
    }

    return cleaned.join('\n').trim();
  }

  async function destroy(): Promise<void> {
    if (!isAliveFlag) return;

    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }

    isAliveFlag = false;
    onData = null;

    if (!proc.killed) {
      proc.kill('SIGTERM');
      await Bun.sleep(100);
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }

    proc.terminal?.close();
  }

  void proc.exited.then(() => {
    isAliveFlag = false;
  });

  return {
    execute,
    destroy,
    get isAlive() {
      return isAliveFlag;
    },
    get workingDirectory() {
      return currentWorkingDirectory;
    },
  };
}
