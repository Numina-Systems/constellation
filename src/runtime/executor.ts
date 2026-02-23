// pattern: Imperative Shell

/**
 * Deno code executor with IPC bridge and controlled permissions.
 * Spawns Deno subprocesses to execute code in a controlled sandbox environment.
 * Manages:
 * - Size validation (code and output)
 * - Permission flags for network, filesystem, environment access
 * - Timeout enforcement
 * - IPC communication with the Deno subprocess
 * - Tool dispatch bridging between Deno code and host tools
 */

import { readFileSync, rmSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

import type { RuntimeConfig } from '@/config/schema';
import type { AgentConfig } from '@/config/schema';
import type {
  CodeRuntime,
  ExecutionResult,
  IpcMessage,
} from '@/runtime/types';
import type { ToolRegistry } from '@/tool/types';

// Reusable text encoder for IPC messages
const encoder = new TextEncoder();

/**
 * Create a CodeRuntime that executes code in Deno subprocesses.
 * Handles permission flags, IPC communication, and resource limits.
 */
export function createDenoExecutor(
  config: RuntimeConfig & AgentConfig,
  registry: ToolRegistry,
): CodeRuntime {
  return {
    async execute(code: string, toolStubs: string): Promise<ExecutionResult> {
      const startTime = Date.now();

      // AC3.8: Size check before execution
      if (code.length > config.max_code_size) {
        return {
          success: false,
          output: '',
          error: `code exceeds max size of ${config.max_code_size} bytes`,
          tool_calls_made: 0,
          duration_ms: Date.now() - startTime,
        };
      }

      // Get the Deno runtime bridge code
      // Resolve path relative to this file's location
      const currentFilePath = new URL(import.meta.url).pathname;
      const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
      const runtimePath = resolve(currentDir, 'deno/runtime.ts');

      let runtimeCode: string;
      try {
        runtimeCode = readFileSync(runtimePath, 'utf-8');
      } catch (readError) {
        return {
          success: false,
          output: '',
          error: `failed to read Deno runtime bridge: ${readError instanceof Error ? readError.message : 'unknown error'}`,
          tool_calls_made: 0,
          duration_ms: Date.now() - startTime,
        };
      }

      // Build combined script: runtime + stubs + user code
      // User code is wrapped in an async IIFE that exits the process on completion.
      // This is necessary because the IPC listener (for await on stdin) keeps the
      // Deno event loop alive indefinitely. Without explicit exit, the subprocess
      // never terminates and the host timeout fires.
      const wrappedUserCode = `
(async () => {
  try {
${code.split('\n').map(line => '    ' + line).join('\n')}
  } catch (__err__) {
    output("Error: " + String(__err__));
  } finally {
    Deno.exit(0);
  }
})();
`;
      const combinedScript = `${runtimeCode}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;

      // Create temporary file in working directory
      const tempFileName = `exec_${randomUUID()}.ts`;
      const scriptPath = resolve(config.working_dir, tempFileName);

      try {
        writeFileSync(scriptPath, combinedScript, 'utf-8');
      } catch {
        return {
          success: false,
          output: '',
          error: 'failed to write temporary execution file',
          tool_calls_made: 0,
          duration_ms: Date.now() - startTime,
        };
      }

      try {
        // Build permission flags
        const permissionFlags: Array<string> = [];

        // Network permission with allowed hosts
        if (config.allowed_hosts.length > 0) {
          permissionFlags.push(`--allow-net=${config.allowed_hosts.join(',')}`);
        } else {
          permissionFlags.push('--deny-net');
        }

        // Filesystem permissions
        permissionFlags.push(`--allow-read=${config.working_dir}`);
        permissionFlags.push(`--allow-write=${config.working_dir}`);

        // Deny dangerous permissions
        permissionFlags.push('--deny-run');
        permissionFlags.push('--deny-env');
        permissionFlags.push('--deny-ffi');

        // Spawn Deno subprocess
        const proc = Bun.spawn(['deno', 'run', ...permissionFlags, scriptPath], {
          stdin: 'pipe',
          stdout: 'pipe',
          stderr: 'pipe',
          cwd: resolve(config.working_dir),
        });

        // Track state
        let accumulatedOutput = '';
        let toolCallCount = 0;
        let timedOut = false;
        let timeoutId: ReturnType<typeof setTimeout> | undefined;

        // Set timeout
        const timeoutPromise = new Promise<void>((resolve) => {
          timeoutId = setTimeout(() => {
            timedOut = true;
            proc.kill();
            resolve();
          }, config.code_timeout);
        });

        try {
          // Helper to handle IPC messages
          const handleIpcMessage = async (message: IpcMessage): Promise<void> => {
            if (message.type === '__output__') {
              accumulatedOutput += message.data + '\n';

              // AC3.8: Check output size limit
              if (accumulatedOutput.length > config.max_output_size) {
                proc.kill();
                throw new Error(
                  `output exceeds max size of ${config.max_output_size} bytes`,
                );
              }
            } else if (message.type === '__tool_call__') {
              toolCallCount += 1;

              // Check tool call limit
              if (toolCallCount > config.max_tool_calls_per_exec) {
                proc.kill();
                throw new Error(
                  `exceeded max tool calls per execution: ${config.max_tool_calls_per_exec}`,
                );
              }

              // Dispatch tool and send result back
              // TypeScript narrows message to IpcToolCall based on the type guard above
              const toolResult = await registry.dispatch(
                message.name,
                message.params,
              );

              const responseMsg =
                toolResult.success || !toolResult.error
                  ? {
                      type: '__tool_result__' as const,
                      call_id: message.call_id,
                      result: toolResult,
                    }
                  : {
                      type: '__tool_error__' as const,
                      call_id: message.call_id,
                      error: toolResult.error || 'unknown error',
                    };

              const stdin = proc.stdin;
              if (stdin) {
                stdin.write(
                  encoder.encode(JSON.stringify(responseMsg) + '\n'),
                );
              }
            }
          };

          // Read stdout and process IPC messages
          const decoder = new TextDecoder();
          let buffer = '';
          // Tracks errors from either JSON parsing or IPC message handling
          let processingError: Error | undefined;

          const readStdout = async (): Promise<void> => {
            const outputStream = proc.stdout;
            if (!outputStream) return;

            const reader = outputStream.getReader();
            try {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              while (true) {
                const { done, value } = await reader.read();

                if (value) {
                  const chunk = decoder.decode(value, { stream: !done });
                  buffer += chunk;

                  // Process complete lines
                  const lines = buffer.split('\n');
                  buffer = lines.pop() || '';

                  for (const line of lines) {
                    if (!line.trim()) continue;

                    try {
                      const parsed = JSON.parse(line);
                      // Validate that message has a valid type property
                      if (
                        !parsed ||
                        typeof parsed !== 'object' ||
                        typeof parsed.type !== 'string'
                      ) {
                        continue;
                      }
                      const message = parsed as IpcMessage;
                      await handleIpcMessage(message);
                    } catch (lineError) {
                      // Ignore JSON parse errors but continue
                      if (!processingError && lineError instanceof Error) {
                        processingError = lineError;
                      }
                    }
                  }
                }

                if (done) break;
              }
            } finally {
              reader.releaseLock();
            }
          };

          // Read stdout and process IPC messages, but enforce timeout by killing process
          await Promise.race([
            readStdout(),
            timeoutPromise,
          ]).catch(() => {
            // Ignore errors from either promise
          });

          // If timeout fired, the process should be killed and stdout will close
          // Close stdin to signal EOF to Deno (for clean IPC listener exit)
          if (!timedOut) {
            try {
              const stdin = proc.stdin;
              if (stdin) {
                stdin.end();
              }
            } catch {
              // stdin might not be available
            }
          }

          // Wait a bit for process to exit naturally, then kill if needed
          try {
            const killTimeout = new Promise<void>((resolve) => {
              setTimeout(resolve, 100);
            });
            await Promise.race([
              proc.exited,
              killTimeout,
            ]);
          } catch {
            // Ignore errors
          }

          // Force kill if still running
          try {
            proc.kill();
          } catch {
            // Already exited
          }

          // Determine exit status
          if (timedOut) {
            return {
              success: false,
              output: accumulatedOutput,
              error: `execution timed out after ${config.code_timeout}ms`,
              tool_calls_made: toolCallCount,
              duration_ms: Date.now() - startTime,
            };
          }

          if (processingError) {
            return {
              success: false,
              output: accumulatedOutput,
              error: processingError.message,
              tool_calls_made: toolCallCount,
              duration_ms: Date.now() - startTime,
            };
          }

          return {
            success: true,
            output: accumulatedOutput.trim(),
            error: null,
            tool_calls_made: toolCallCount,
            duration_ms: Date.now() - startTime,
          };
        } catch (error) {
          if (timedOut) {
            return {
              success: false,
              output: accumulatedOutput,
              error: `execution timed out after ${config.code_timeout}ms`,
              tool_calls_made: toolCallCount,
              duration_ms: Date.now() - startTime,
            };
          }

          return {
            success: false,
            output: accumulatedOutput,
            error: error instanceof Error ? error.message : 'unknown error',
            tool_calls_made: toolCallCount,
            duration_ms: Date.now() - startTime,
          };
        } finally {
          // Clear timeout to prevent resource leak
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          try {
            proc.kill();
          } catch {
            // Process already exited
          }
        }
      } finally {
        // Clean up temporary file
        try {
          rmSync(scriptPath);
        } catch {
          // File may not exist or already cleaned up
        }
      }
    },
  };
}
