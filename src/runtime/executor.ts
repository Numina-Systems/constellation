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
  ExecutionContext,
  IpcMessage,
} from '@/runtime/types';
import type { ToolRegistry } from '@/tool/types';

// Reusable text encoder for IPC messages
const encoder = new TextEncoder();

/**
 * Generate Bluesky credential constants for injection into sandbox code.
 * Returns a block of TypeScript const declarations, or empty string if no credentials.
 * Pure function for testability.
 */
export function generateCredentialConstants(context?: ExecutionContext): string {
  if (!context?.bluesky) return '';
  const { service, accessToken, refreshToken, did, handle } = context.bluesky;
  return [
    `const BSKY_SERVICE = ${JSON.stringify(service)};`,
    `const BSKY_ACCESS_TOKEN = ${JSON.stringify(accessToken)};`,
    `const BSKY_REFRESH_TOKEN = ${JSON.stringify(refreshToken)};`,
    `const BSKY_DID = ${JSON.stringify(did)};`,
    `const BSKY_HANDLE = ${JSON.stringify(handle)};`,
  ].join('\n');
}

/**
 * Create a CodeRuntime that executes code in Deno subprocesses.
 * Handles permission flags, IPC communication, and resource limits.
 */
export function createDenoExecutor(
  config: RuntimeConfig & AgentConfig,
  registry: ToolRegistry,
): CodeRuntime {
  return {
    async execute(code: string, toolStubs: string, context?: ExecutionContext): Promise<ExecutionResult> {
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

      // The runtime bridge is read host-side here and concatenated into the temp script file
      // below. Deno never needs read access to src/ for the user's code to execute.
      // All tool stubs are generated and injected server-side.

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

      // Build combined script: runtime + credentials + stubs + user code
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
      const credentialBlock = generateCredentialConstants(context);
      const combinedScript = `${runtimeCode}\n\n// Credentials\n${credentialBlock}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;

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
        // When bluesky credentials are present, the PDS host must also be permitted.
        // The AT Protocol redirects write operations to the user's PDS, which is a
        // dynamically assigned host (e.g. bankera.us-west.host.bsky.network).
        const extraHosts: Array<string> = [];
        if (context?.bluesky?.pdsUrl) {
          try {
            const pdsHostname = new URL(context.bluesky.pdsUrl).hostname;
            if (pdsHostname && !config.allowed_hosts.includes(pdsHostname)) {
              extraHosts.push(pdsHostname);
            }
          } catch {
            // Invalid URL — skip
          }
        }

        const allHosts = [...config.allowed_hosts, ...extraHosts];
        if (allHosts.length > 0) {
          permissionFlags.push(`--allow-net=${allHosts.join(',')}`);
        } else {
          permissionFlags.push('--deny-net');
        }

        // Filesystem permissions: working_dir always readable + any extra read-only paths
        // Resolve allowed_read_paths from project root, not subprocess cwd
        const resolvedReadPaths = config.allowed_read_paths.map(p => resolve(p));
        const readPaths = [config.working_dir, ...resolvedReadPaths];
        permissionFlags.push(`--allow-read=${readPaths.join(',')}`);
        permissionFlags.push(`--allow-write=${config.working_dir}`);

        // Subprocess permissions: allowlist if configured, deny otherwise
        if (config.allowed_run.length > 0) {
          permissionFlags.push(`--allow-run=${config.allowed_run.join(',')}`);
        } else {
          permissionFlags.push('--deny-run');
        }
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

          // Read stderr to capture Deno errors (permission denials, crashes, etc.)
          let stderrOutput = '';
          const readStderr = async (): Promise<void> => {
            const errStream = proc.stderr;
            if (!errStream) return;

            const errReader = errStream.getReader();
            const errDecoder = new TextDecoder();
            try {
              // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
              while (true) {
                const { done, value } = await errReader.read();
                if (value) {
                  stderrOutput += errDecoder.decode(value, { stream: !done });
                }
                if (done) break;
              }
            } finally {
              errReader.releaseLock();
            }
          };

          // Read stdout and stderr in parallel, enforce timeout by killing process
          await Promise.race([
            Promise.all([readStdout(), readStderr()]),
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

          // If no IPC output was produced but stderr has content, the Deno process
          // likely crashed (e.g. permission denial, unhandled rejection). Surface
          // the stderr as an error so the agent gets actionable feedback.
          if (!accumulatedOutput.trim() && stderrOutput.trim()) {
            return {
              success: false,
              output: '',
              error: stderrOutput.trim().slice(0, 2000),
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
