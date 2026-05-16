// pattern: Imperative Shell

import { stripAnsi } from './ansi';
import { truncateOutput } from './truncate';
import type { ShellConfig, ShellSession, ShellResult } from './types';

const DEFAULT_CONFIG: ShellConfig = {
  shell: process.env['SHELL'] || '/bin/bash',
  commandTimeout: 30_000,
  idleTimeout: 10 * 60 * 1000,
  maxOutputBytes: 1024 * 1024,
  promptMarker: '___MARKER___',
};

export class ShellCreationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShellCreationError';
  }
}

function resolveConfig(partial?: Partial<ShellConfig>): ShellConfig {
  return { ...DEFAULT_CONFIG, ...partial };
}

function checkNotRoot(): void {
  const getuid = process.getuid;
  if (getuid?.() === 0) {
    throw new ShellCreationError(
      'cannot create shell session while running as root'
    );
  }
}

async function createShellSession(
  partial?: Partial<ShellConfig>
): Promise<ShellSession> {
  checkNotRoot();

  const config = resolveConfig(partial);
  const { shell, idleTimeout, commandTimeout, maxOutputBytes, promptMarker } =
    config;

  let proc: ReturnType<typeof Bun.spawn>;
  let outputBuffer = '';

  try {
    proc = Bun.spawn([shell, '-i'], {
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, data) {
          const text = new TextDecoder().decode(data);
          outputBuffer += text;
        },
      },
    });
  } catch (err) {
    throw new ShellCreationError(`failed to spawn shell '${shell}': ${err}`);
  }

  let isAliveFlag = true;
  let currentWorkingDirectory = process.cwd();
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let commandTimeout_: ReturnType<typeof setTimeout> | null = null;
  let commandGraceTimer_: ReturnType<typeof setTimeout> | null = null;
  let pendingResolve: ((result: ShellResult) => void) | null = null;
  let pendingReject: ((error: Error) => void) | null = null;

  // Pattern for marker: [MARKER<exitcode>]>
  const markerEscaped = promptMarker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function resetIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      destroy();
    }, idleTimeout);
  }

  function clearIdleTimer(): void {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  }

  function clearCommandTimers(): void {
    if (commandTimeout_ !== null) {
      clearTimeout(commandTimeout_);
      commandTimeout_ = null;
    }
    if (commandGraceTimer_ !== null) {
      clearTimeout(commandGraceTimer_);
      commandGraceTimer_ = null;
    }
  }

  // Initialize shell with PS1 that includes marker and exit code
  // Format: [MARKER<exitcode>]>
  const initSequence = `PS1="[${promptMarker}\\$?]> "\n`;
  proc.terminal!.write(initSequence);

  // Wait for the first prompt
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(
        new ShellCreationError('timeout waiting for shell prompt')
      );
    }, 5000);

    const checkPrompt = () => {
      if (outputBuffer.includes(`[${promptMarker}`)) {
        clearTimeout(timeout);
        clearInterval(interval);
        resolve();
      }
    };

    const interval = setInterval(checkPrompt, 50);
    checkPrompt();
  });

  resetIdleTimer();

  async function execute(command: string): Promise<ShellResult> {
    if (!isAliveFlag) {
      throw new Error('shell session is not alive');
    }

    // Remember the buffer length when command starts
    const outputStartIndex = outputBuffer.length;
    clearCommandTimers();
    resetIdleTimer();

    let timedOut = false;
    let exitCode: number | null = null;
    let commandTimeoutFired = false;

    // Write command to terminal
    proc.terminal!.write(`${command}\n`);

    // Create promise that resolves when marker appears
    const executePromise = new Promise<ShellResult>((resolve, reject) => {
      pendingResolve = resolve;
      pendingReject = reject;

      // Command timeout handler
      commandTimeout_ = setTimeout(() => {
        if (commandTimeoutFired) return;
        commandTimeoutFired = true;
        timedOut = true;

        // Send SIGINT to try graceful shutdown
        proc.kill('SIGINT');

        // Wait for grace period to see if marker appears
        commandGraceTimer_ = setTimeout(() => {
          // Grace period expired, escalate to SIGKILL
          proc.kill('SIGKILL');
          isAliveFlag = false;

          clearCommandTimers();

          if (pendingReject) {
            pendingReject(
              new Error(
                'command timeout: process killed after ignoring SIGINT'
              )
            );
            pendingReject = null;
          }
        }, 5000);
      }, commandTimeout);

      // Poll for marker in outputBuffer using async polling
      const checkForMarker = async (): Promise<void> => {
        while (pendingResolve !== null) {
          // Look for markers AFTER the output started (re-check each time)
          const newOutput = outputBuffer.substring(outputStartIndex);

          // Find LAST marker in the new output
          // Reset regex so exec() starts from beginning
          const markerRegex = new RegExp(
            `\\[${markerEscaped}(\\d+)\\]>`,
            'g'
          );
          let match: RegExpExecArray | null;
          let lastMatch: RegExpExecArray | null = null;

          // eslint-disable-next-line no-cond-assign
          while ((match = markerRegex.exec(newOutput)) !== null) {
            lastMatch = match;
          }

          if (lastMatch) {
            clearCommandTimers();

            // Parse exit code from last marker
            exitCode = lastMatch[1] ? parseInt(lastMatch[1], 10) : 0;

            // Extract output BEFORE the last marker
            // The index in lastMatch is relative to newOutput
            const markerPosInNew = lastMatch.index || 0;
            let outputText = newOutput.substring(0, markerPosInNew);

            // Clean: strip ANSI, remove command echo, trim
            outputText = stripAnsi(outputText);

            // Remove the echoed command line
            // The command will typically appear on its own line right after we send it
            const lines = outputText.split('\n');
            const outputLines: Array<string> = [];

            for (const line of lines) {
              const trimmed = (line ?? '').trim();

              // Skip the command echo (the command itself as a line)
              if (trimmed === command) {
                continue;
              }
              // Skip shell-specific noise
              if (trimmed.startsWith('bash') || trimmed.startsWith('PS1=')) {
                continue;
              }
              // Skip empty lines and pure prompts
              if (trimmed === '' || trimmed.match(/^[%#$>]\s*$/)) {
                continue;
              }

              outputLines.push(line ?? '');
            }

            let cleanOutput = outputLines.join('\n').trim();
            cleanOutput = truncateOutput(cleanOutput, maxOutputBytes);

            // Append timeout message if applicable
            if (timedOut) {
              cleanOutput += `\n[timeout after ${commandTimeout / 1000}s]`;
            }

            const result: ShellResult = {
              output: cleanOutput,
              exitCode,
              workingDirectory: currentWorkingDirectory,
              timedOut,
            };

            if (pendingResolve) {
              pendingResolve(result);
              pendingResolve = null;
            }
            return;
          }

          // Wait a bit before checking again
          await new Promise(r => setTimeout(r, 10));
        }
      };

      // Start the polling task
      void checkForMarker();
    });

    try {
      return await executePromise;
    } finally {
      clearCommandTimers();
      pendingResolve = null;
      pendingReject = null;
    }
  }

  async function destroy(): Promise<void> {
    clearIdleTimer();
    clearCommandTimers();

    if (pendingReject) {
      pendingReject(new Error('session destroyed'));
      pendingReject = null;
    }

    isAliveFlag = false;

    // Try graceful shutdown with SIGTERM
    if (!proc.killed) {
      proc.kill('SIGTERM');

      // Wait a bit for clean exit
      await new Promise(r => setTimeout(r, 100));

      // If still alive, force kill
      if (!proc.killed) {
        proc.kill('SIGKILL');
      }
    }

    proc.terminal?.close();
  }

  // Monitor process exit
  void proc.exited.catch(() => {
    isAliveFlag = false;
  });

  const session: ShellSession = {
    execute,
    destroy,
    get isAlive() {
      return isAliveFlag;
    },
    get workingDirectory() {
      return currentWorkingDirectory;
    },
  };

  return session;
}

export { createShellSession };
