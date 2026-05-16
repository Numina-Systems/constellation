// pattern: Imperative Shell

import crypto from 'node:crypto';
import { stripAnsi } from './ansi.ts';
import { truncateOutput } from './truncate.ts';
import type { ShellConfig, ShellSession, ShellResult } from './types.ts';
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

  function waitForMarker(
    markerRegex: RegExp,
    startIndex: number,
    timeoutMs: number,
  ): Promise<{ match: RegExpExecArray; output: string } | null> {
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
  const initMarkerRegex = new RegExp(
    `\\[${promptMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\]> `,
  );
  proc.terminal!.write(`PS1="[${promptMarker}\\$?]> "\n`);

  const initResult = await waitForMarker(initMarkerRegex, 0, 5000);
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

    // Generate per-command nonce and markers
    const nonce = crypto.randomBytes(4).toString('hex');
    const marker = `${promptMarker}_${nonce}`;
    const cwdMarker = `___CWD_${nonce}___`;

    const markerRegex = new RegExp(
      `\\[${marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)\\]> `,
    );
    const cwdPattern = new RegExp(`${cwdMarker} (.+?) ${cwdMarker}`);

    outputBuffer = '';
    const outputStartIndex = 0;

    // Set PS1 for this command and wrap: run command, save exit code, emit cwd, restore exit code
    // Use ; to keep on one line so bash doesn't echo the PS1 assignment separately
    const wrappedCommand = `PS1="[${marker}\\$?]> "; ${command}; __x=$?; echo "${cwdMarker} $(pwd) ${cwdMarker}"; (exit $__x)`;

    proc.terminal!.write(wrappedCommand + '\n');

    // Wait for nonce-scoped marker
    const result = await waitForMarker(markerRegex, outputStartIndex, commandTimeout);

    if (result) {
      return buildResult(result.match, result.output, command, cwdPattern, false);
    }

    // Timeout — send Ctrl+C via terminal (SIGINT to foreground process group)
    proc.terminal!.write('\x03');

    // Grace period: wait for marker after interrupt
    const graceResult = await waitForMarker(markerRegex, outputStartIndex, 2000);

    if (graceResult) {
      return buildResult(graceResult.match, graceResult.output, command, cwdPattern, true);
    }

    // SIGKILL escalation — process ignored interrupt
    proc.kill('SIGKILL');
    isAliveFlag = false;

    const partialOutput = cleanOutput(
      outputBuffer.substring(outputStartIndex),
      command,
      cwdPattern,
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
    cwdPattern: RegExp,
    timedOut: boolean,
  ): ShellResult {
    const exitCode = parseInt(match[1] ?? '0', 10);
    const rawBeforeMarker = segment.substring(0, match.index);
    let output = cleanOutput(rawBeforeMarker, command, cwdPattern);

    if (timedOut) {
      output += `\n[timeout after ${commandTimeout / 1000}s]`;
    }

    output = truncateOutput(output, maxOutputBytes);

    return { output, exitCode, workingDirectory: currentWorkingDirectory, timedOut };
  }

  function cleanOutput(raw: string, command: string, cwdPattern: RegExp): string {
    const text = stripAnsi(raw);
    const lines = text.split('\n');
    const cleaned: Array<string> = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Extract cwd from our injected echo
      const cwdMatch = cwdPattern.exec(trimmed);
      if (cwdMatch) {
        currentWorkingDirectory = cwdMatch[1] ?? currentWorkingDirectory;
        continue;
      }

      // Skip empty lines and prompts
      if (trimmed === '' || /^[%#$>]\s*$/.test(trimmed)) continue;

      // Skip lines that are part of the wrapped command echo
      // Pattern: PS1="..."; <command>; __x=$?; echo "..."; (exit $__x)
      if (trimmed.includes(`PS1="`) && trimmed.includes(`\\$?`)) {
        // This is the PS1 assignment part, skip
        continue;
      }
      if (trimmed === command) {
        // Exact command match
        continue;
      }
      if (trimmed === '__x=$?') {
        // Part of the wrapped command
        continue;
      }
      if (trimmed === '(exit $__x)') {
        // Part of the wrapped command
        continue;
      }

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
