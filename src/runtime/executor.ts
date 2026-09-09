// pattern: Imperative Shell

/** Deno subprocess executor with one owner for lifetime, bounded streams, and IPC admission. */

import {randomUUID} from 'crypto';
import {readFileSync, rmSync, writeFileSync} from 'fs';
import {resolve} from 'path';

import type {AgentConfig, RuntimeConfig} from '@/config/schema';
import type {ExecutionOptions} from '@/contracts/execution.ts';
import type {ToolRegistry} from '@/tool/types';
import {isJavaScriptIdentifier, reservedRuntimeBindings} from '@/custom-tool/validation.js';
import {
  appendUserOutput,
  createExecutionLifecycle,
  createFrameParser,
  type ExecutionLifecycle,
  type RuntimeLimits,
} from './policy.ts';
import type {CodeRuntime, ExecutionContext, ExecutionResult, IpcMessage} from './types';

const MAX_UNRESOLVED_CALL_IDS = 128;
const MAX_DIAGNOSTIC_BYTES = 2_000;
const CLEANUP_TIMEOUT_MS = 100;
const DEFAULT_MAX_STDOUT_BYTES = 4_194_304;
const DEFAULT_MAX_STDERR_BYTES = 65_536;
const DEFAULT_MAX_IPC_FRAME_BYTES = 1_048_576;

export type RuntimeProcess = {
  readonly stdin: {
    readonly write: (bytes: Uint8Array) => void | Promise<void>;
    readonly end: () => void;
    readonly abort?: (reason?: unknown) => void | Promise<void>;
  } | null;
  readonly stdout: ReadableStream<Uint8Array> | null;
  readonly stderr: ReadableStream<Uint8Array> | null;
  readonly exited: Promise<number>;
  readonly kill: () => void;
};

export type ProcessFactory = (options: Readonly<{
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
}>) => RuntimeProcess;

function spawnBunProcess(options: Readonly<{readonly args: ReadonlyArray<string>; readonly cwd: string}>): RuntimeProcess {
  // Bun's Subprocess is structurally compatible with the narrow runtime port.
  return Bun.spawn([...options.args], {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    cwd: options.cwd,
  }) as unknown as RuntimeProcess;
}

/** Generate Bluesky credential constants for injected sandbox code. */
export function generateCredentialConstants(context?: ExecutionContext): string {
  if (!context?.bluesky) return '';
  const {service, accessToken, refreshToken, did, handle} = context.bluesky;
  return [
    `const BSKY_SERVICE = ${JSON.stringify(service)};`,
    `const BSKY_ACCESS_TOKEN = ${JSON.stringify(accessToken)};`,
    `const BSKY_REFRESH_TOKEN = ${JSON.stringify(refreshToken)};`,
    `const BSKY_DID = ${JSON.stringify(did)};`,
    `const BSKY_HANDLE = ${JSON.stringify(handle)};`,
  ].join('\n');
}

/** Validate a generated TypeScript identifier. */
export function isValidIdentifier(key: string): boolean {
  return isJavaScriptIdentifier(key);
}

/** Generate validated secret constants for injected sandbox code. */
export function generateSecretConstants(context?: ExecutionContext): string {
  if (!context?.secrets) return '';
  const reservedBindings = reservedRuntimeBindings();
  return Object.entries(context.secrets)
    .filter(([key]) => {
      if (!isValidIdentifier(key)) return false;
      if (!reservedBindings.has(key)) return true;
      console.warn(`[runtime] skipped secret binding reserved by execution environment: ${key}`);
      return false;
    })
    .map(([key, value]) => `const ${key} = ${JSON.stringify(value)};`)
    .join('\n');
}

function makeResult(
  startTime: number,
  success: boolean,
  output: string,
  error: string | null,
  calls: number,
  outcome: ExecutionResult['outcome'],
  unresolved: ReadonlySet<string>,
): ExecutionResult {
  const unresolvedIds = Array.from(unresolved).slice(0, MAX_UNRESOLVED_CALL_IDS);
  return {
    success,
    output: output.trim(),
    error,
    tool_calls_made: calls,
    duration_ms: Date.now() - startTime,
    outcome,
    unresolved_call_ids: unresolvedIds,
    unresolved_call_count: unresolved.size,
  };
}

function isStdoutOverflowError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message.startsWith('stdout exceeds max raw byte size') || error.message.startsWith('output exceeds max size');
}

function asIpcMessage(value: unknown): IpcMessage {
  if (typeof value !== 'object' || value === null || typeof (value as Record<string, unknown>)['type'] !== 'string') {
    throw new Error('malformed nonempty IPC frame');
  }
  const candidate = value as Record<string, unknown>;
  const type = candidate['type'];
  if (type === '__output__' && typeof candidate['data'] === 'string') {
    return {type, data: candidate['data']};
  }
  if (type === '__debug__' && typeof candidate['message'] === 'string') {
    return {type, message: candidate['message']};
  }
  if (type === '__tool_call__' && typeof candidate['name'] === 'string' &&
      typeof candidate['call_id'] === 'string' && typeof candidate['params'] === 'object' &&
      candidate['params'] !== null && !Array.isArray(candidate['params'])) {
    return {type, name: candidate['name'], call_id: candidate['call_id'], params: candidate['params'] as Record<string, unknown>};
  }
  throw new Error('malformed nonempty IPC frame');
}

function mergeOptions(context?: ExecutionContext): ExecutionOptions | undefined {
  if (!context?.signal && context?.deadline === undefined && !context?.budget) return undefined;
  return {signal: context.signal, deadline: context.deadline, budget: context.budget};
}

function waitForClosure(lifecycle: ExecutionLifecycle, promise: Promise<void>): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => true),
    lifecycle.closed.then(() => false),
  ]);
}

/** Create a CodeRuntime that executes code in Deno subprocesses. */
export function createDenoExecutor(
  config: RuntimeConfig & AgentConfig,
  registry: ToolRegistry,
  processFactory: ProcessFactory = spawnBunProcess,
): CodeRuntime {
  return {
    async execute(code: string, toolStubs: string, context?: ExecutionContext): Promise<ExecutionResult> {
      const startTime = Date.now();
      const emptyUnresolved = new Set<string>();
      if (context?.signal?.aborted) {
        return makeResult(startTime, false, '', 'execution cancelled', 0, 'cancelled', emptyUnresolved);
      }
      if (new TextEncoder().encode(code).byteLength > config.max_code_size) {
        return makeResult(startTime, false, '', `code exceeds max size of ${config.max_code_size} bytes`, 0, 'error', emptyUnresolved);
      }

      const limits: RuntimeLimits = {
        max_stdout_bytes: config.max_stdout_bytes ?? DEFAULT_MAX_STDOUT_BYTES,
        max_stderr_bytes: config.max_stderr_bytes ?? DEFAULT_MAX_STDERR_BYTES,
        max_ipc_frame_bytes: config.max_ipc_frame_bytes ?? DEFAULT_MAX_IPC_FRAME_BYTES,
        max_output_size: config.max_output_size,
      };
      const runtimePath = resolve(new URL(import.meta.url).pathname.replace(/\/[^/]*$/, ''), 'deno/runtime.ts');
      let runtimeCode: string;
      try {
        runtimeCode = readFileSync(runtimePath, 'utf-8');
      } catch (error) {
        return makeResult(startTime, false, '', `failed to read Deno runtime bridge: ${error instanceof Error ? error.message : 'unknown error'}`, 0, 'error', emptyUnresolved);
      }

      const wrappedUserCode = `(async () => {\n  try {\n${code.split('\n').map((line) => `    ${line}`).join('\n')}\n  } catch (__err__) {\n    output("Error: " + String(__err__));\n  } finally {\n    Deno.exit(0);\n  }\n})();\n`;
      const combinedScript = `${runtimeCode}\n\n// Credentials\n${generateCredentialConstants(context)}\n\n// Secrets\n${generateSecretConstants(context)}\n\n// Tool stubs\n${toolStubs}\n\n// User code\n${wrappedUserCode}`;
      const scriptPath = resolve(config.working_dir, `exec_${randomUUID()}.ts`);
      try {
        writeFileSync(scriptPath, combinedScript, 'utf-8');
      } catch {
        return makeResult(startTime, false, '', 'failed to write temporary execution file', 0, 'error', emptyUnresolved);
      }

      const lifecycle = createExecutionLifecycle();
      let process: RuntimeProcess | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let deadlineId: ReturnType<typeof setTimeout> | null = null;
      let exitDrainId: ReturnType<typeof setTimeout> | null = null;
      let output = '';
      let stderrOutput = '';
      let diagnostics = '';
      let toolCallCount = 0;
      let processExitCode: number | null = null;
      let terminalError: string | null = null;
      const unresolved = new Set<string>();
      const dispatchQueue: Array<{readonly message: Extract<IpcMessage, {type: '__tool_call__'}>}> = [];
      let pumpActive = false;
      const readers: Array<{readonly cancel: () => Promise<unknown>}> = [];

      const closeProcess = (): void => {
        if (process === null) return;
        try { process.stdin?.abort?.(lifecycle.reason()); } catch { /* best effort */ }
        try { process.stdin?.end(); } catch { /* best effort */ }
        try { process.kill(); } catch { /* best effort */ }
        for (const reader of readers) {
          void reader.cancel().catch(() => undefined);
        }
      };
      const close = (reason: Parameters<ExecutionLifecycle['close']>[0], error?: string): void => {
        if (error && terminalError === null) terminalError = error;
        if (lifecycle.close(reason)) closeProcess();
      };

      const pumpDispatch = async (): Promise<void> => {
        if (pumpActive) return;
        pumpActive = true;
        try {
          while (lifecycle.isOpen() && dispatchQueue.length > 0) {
            const item = dispatchQueue.shift();
            if (!item || !lifecycle.isOpen()) break;
            const message = item.message;
            if (!lifecycle.isOpen()) break;
            unresolved.add(message.call_id);
            const dispatchPromise = registry.dispatch(message.name, message.params, mergeOptions(context));
            const completed = await Promise.race([
              dispatchPromise.then((value) => ({done: true as const, value}), (error: unknown) => ({done: true as const, error})),
              lifecycle.closed.then(() => ({done: false as const})),
            ]);
            if (!completed.done) {
              void dispatchPromise.then(() => undefined, () => undefined);
              continue;
            }
            unresolved.delete(message.call_id);
            if (!lifecycle.isOpen()) continue;
            const response = 'error' in completed
              ? {type: '__tool_error__' as const, call_id: message.call_id, error: completed.error instanceof Error ? completed.error.message : String(completed.error)}
              : {type: '__tool_result__' as const, call_id: message.call_id, result: completed.value};
            try {
              if (lifecycle.isOpen()) await Promise.resolve(process?.stdin?.write(new TextEncoder().encode(`${JSON.stringify(response)}\n`)));
            } catch (error) {
              close('process_failure', `failed to write tool result: ${error instanceof Error ? error.message : 'unknown error'}`);
            }
          }
        } finally {
          pumpActive = false;
        }
      };

      const readStdout = async (): Promise<void> => {
        if (!process?.stdout) return;
        const parser = createFrameParser('stdout', limits);
        const reader = process.stdout.getReader();
        readers.push({cancel: () => reader.cancel()});
        try {
          while (lifecycle.isOpen()) {
            const chunk = await reader.read();
            const frames = parser.push(chunk.value ?? new Uint8Array(0), chunk.done);
            for (const frame of frames) {
              if (!lifecycle.isOpen()) break;
              const message = asIpcMessage(JSON.parse(frame.text));
              if (message.type === '__output__') output = appendUserOutput(output, message.data, limits.max_output_size);
              else if (message.type === '__debug__') {
                diagnostics = `${diagnostics}${message.message}`.slice(0, MAX_DIAGNOSTIC_BYTES);
              } else if (message.type === '__tool_call__') {
                toolCallCount += 1;
                if (toolCallCount > config.max_tool_calls_per_exec) {
                  close('protocol_error', `exceeded max tool calls per execution: ${config.max_tool_calls_per_exec}`);
                  break;
                }
                if (dispatchQueue.length >= config.max_tool_calls_per_exec || !lifecycle.isOpen()) {
                  close('protocol_overflow', 'dispatch queue exceeds bounded capacity');
                  break;
                }
                dispatchQueue.push({message});
                void pumpDispatch();
              }
            }
            if (chunk.done) break;
          }
        } finally {
          reader.releaseLock();
        }
      };

      const readStderr = async (): Promise<void> => {
        if (!process?.stderr) return;
        let bytesSeen = 0;
        const decoder = new TextDecoder('utf-8', {fatal: true});
        const reader = process.stderr.getReader();
        readers.push({cancel: () => reader.cancel()});
        try {
          while (lifecycle.isOpen()) {
            const chunk = await reader.read();
            const bytes = chunk.value ?? new Uint8Array(0);
            bytesSeen += bytes.byteLength;
            if (bytesSeen > limits.max_stderr_bytes) {
              close('stderr_overflow', `stderr exceeds max raw byte size of ${limits.max_stderr_bytes}`);
              break;
            }
            if (bytes.byteLength > 0) stderrOutput = `${stderrOutput}${decoder.decode(bytes, {stream: !chunk.done})}`.slice(0, MAX_DIAGNOSTIC_BYTES);
            if (chunk.done) {
              stderrOutput = `${stderrOutput}${decoder.decode()}`.slice(0, MAX_DIAGNOSTIC_BYTES);
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }
      };

      try {
        const permissionFlags: Array<string> = [];
        if (config.unrestricted) permissionFlags.push('--allow-all');
        else {
          const extraHosts: Array<string> = [];
          if (context?.bluesky?.pdsUrl) {
            try {
              const hostname = new URL(context.bluesky.pdsUrl).hostname;
              if (hostname && !config.allowed_hosts.includes(hostname)) extraHosts.push(hostname);
            } catch { /* invalid context URL cannot widen permissions */ }
          }
          const hosts = [...config.allowed_hosts, ...extraHosts];
          permissionFlags.push(hosts.length > 0 ? `--allow-net=${hosts.join(',')}` : '--deny-net');
          const readPaths = [config.working_dir, ...config.allowed_read_paths.map((path) => resolve(path)), ...config.allowed_write_paths.map((path) => resolve(path))];
          const writePaths = [config.working_dir, ...config.allowed_write_paths.map((path) => resolve(path))];
          permissionFlags.push(`--allow-read=${readPaths.join(',')}`, `--allow-write=${writePaths.join(',')}`);
          permissionFlags.push(config.allowed_run.length > 0 ? `--allow-run=${config.allowed_run.join(',')}` : '--deny-run', '--deny-env', '--deny-ffi');
        }
        process = processFactory({args: ['deno', 'run', ...permissionFlags, scriptPath], cwd: resolve(config.working_dir)});
        const abortHandler = (): void => close(context?.signal?.aborted ? 'cancelled' : 'timeout');
        context?.signal?.addEventListener('abort', abortHandler, {once: true});
        if (context?.signal?.aborted) close('cancelled');
        timeoutId = setTimeout(() => close('timeout', `execution timed out after ${config.code_timeout}ms`), config.code_timeout);
        if (context?.deadline !== undefined) {
          const remaining = context.deadline - Date.now();
          deadlineId = setTimeout(() => close('timeout', 'execution deadline exceeded'), Math.max(0, remaining));
        }
        void process.exited.then((code) => {
          processExitCode = code;
          if (lifecycle.isOpen()) {
            exitDrainId = setTimeout(() => close(code === 0 ? 'completed' : 'process_failure', code === 0 ? undefined : `sandbox process exited with code ${code}`), CLEANUP_TIMEOUT_MS);
          }
        }, () => close('process_failure', 'sandbox process exit could not be observed'));
        const stdoutPromise = readStdout().catch((error: unknown) => {
          const message = error instanceof Error ? error.message : 'stdout protocol failure';
          close(isStdoutOverflowError(error) ? 'stdout_overflow' : 'protocol_error', message);
        });
        const stderrPromise = readStderr().catch((error: unknown) => {
          close('stderr_overflow', error instanceof Error ? error.message : 'stderr stream failure');
        });
        await waitForClosure(lifecycle, Promise.all([stdoutPromise, stderrPromise]).then(() => undefined));
        if (processExitCode === null) {
          await Promise.race([process.exited.then(() => undefined, () => undefined), new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))]);
        }
        if (lifecycle.isOpen() && processExitCode !== null && processExitCode !== 0) {
          close('process_failure', `sandbox process exited with code ${processExitCode}`);
        }
        if (lifecycle.isOpen()) close('completed');
        await Promise.race([Promise.allSettled([stdoutPromise, stderrPromise]), new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))]);
        context?.signal?.removeEventListener('abort', abortHandler);
        const reason = lifecycle.reason();
        if (reason === 'timeout') return makeResult(startTime, false, output, terminalError ?? 'execution timed out', toolCallCount, unresolved.size > 0 ? 'outcome_unknown' : 'cancelled', unresolved);
        if (reason === 'cancelled') return makeResult(startTime, false, output, terminalError ?? 'execution cancelled', toolCallCount, unresolved.size > 0 ? 'outcome_unknown' : 'cancelled', unresolved);
        if (reason !== 'completed') return makeResult(startTime, false, output, terminalError ?? (stderrOutput.trim() || diagnostics.trim() || `sandbox execution failed (${reason})`), toolCallCount, unresolved.size > 0 ? 'outcome_unknown' : 'error', unresolved);
        if (!output.trim() && stderrOutput.trim()) return makeResult(startTime, false, '', stderrOutput.trim(), toolCallCount, 'error', unresolved);
        return makeResult(startTime, processExitCode === 0 || processExitCode === null, output, processExitCode === 0 || processExitCode === null ? null : `sandbox process exited with code ${processExitCode}`, toolCallCount, 'success', unresolved);
      } catch (error) {
        close('protocol_error', error instanceof Error ? error.message : 'unknown runtime error');
        return makeResult(startTime, false, output, terminalError ?? 'unknown runtime error', toolCallCount, unresolved.size > 0 ? 'outcome_unknown' : 'error', unresolved);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (deadlineId !== null) clearTimeout(deadlineId);
        if (exitDrainId !== null) clearTimeout(exitDrainId);
        if (lifecycle.isOpen()) close('cleanup');
        closeProcess();
        try { await Promise.race([process?.exited ?? Promise.resolve(0), new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_TIMEOUT_MS))]); } catch { /* bounded cleanup */ }
        try { rmSync(scriptPath); } catch { /* best effort */ }
      }
    },
  };
}
