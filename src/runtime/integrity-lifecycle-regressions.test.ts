import {afterEach, beforeEach, describe, expect, it} from 'bun:test';
import {mkdtempSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';

import type {AgentConfig, RuntimeConfig} from '@/config/schema.ts';
import {createDenoExecutor, type ProcessFactory} from './executor.ts';
import {
  appendUserOutput,
  createFrameParser,
  type RuntimeLimits,
} from './policy.ts';
import type {ToolRegistry, ToolResult} from '@/tool/types.ts';
import {createControlledRuntimeProcess, type ControlledRuntimeProcess} from '@/testing/runtime-process.ts';
import {createDeferred} from '@/testing/deferred.ts';

function createRuntimeConfig(overrides: Partial<RuntimeConfig & AgentConfig> = {}): RuntimeConfig & AgentConfig {
  return {
    working_dir: '',
    unrestricted: true,
    allowed_hosts: [],
    allowed_read_paths: [],
    allowed_write_paths: [],
    allowed_run: [],
    max_stdout_bytes: 4_096,
    max_stderr_bytes: 256,
    max_ipc_frame_bytes: 512,
    max_code_size: 4_096,
    max_output_size: 128,
    code_timeout: 1_000,
    max_tool_calls_per_exec: 8,
    max_tool_rounds: 4,
    context_budget: 0.8,
    max_context_tokens: 1_000,
    recall_enabled: false,
    recall_token_budget: 64,
    diary_enabled: false,
    diary_token_budget: 64,
    diary_max_entries: 1,
    cache_diagnostics: false,
    checkpoint_interval: 0,
    checkpoint_retention: 1,
    auto_resume: false,
    ...overrides,
  };
}

function createRegistry(
  dispatch: (name: string, params: Record<string, unknown>, options?: unknown) => Promise<ToolResult>,
): ToolRegistry {
  return {
    register: () => undefined,
    unregister: () => false,
    getDefinitions: () => [],
    dispatch,
    generateStubs: () => '',
    toModelTools: () => [],
  };
}

function toolCall(callId: string, name = 'deferred_tool'): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({
    type: '__tool_call__',
    name,
    params: {callId},
    call_id: callId,
  })}\n`);
}

function outputFrame(data: string): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({type: '__output__', data})}\n`);
}

function debugFrame(message: string): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify({type: '__debug__', message})}\n`);
}

function createExecutorWithProcess(
  config: RuntimeConfig & AgentConfig,
  registry: ToolRegistry,
  process: ControlledRuntimeProcess,
): ReturnType<typeof createDenoExecutor> {
  const processFactory: ProcessFactory = () => process;
  return createDenoExecutor(config, registry, processFactory);
}

function waitForProcessCapture(process: ControlledRuntimeProcess): Promise<void> {
  return Promise.resolve().then(() => {
    if (process.observations.stdoutCancelled || process.observations.killed) {
      throw new Error('process closed before test event was sent');
    }
  });
}

let workdir = '';

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'constellation-runtime-regression-'));
});

afterEach(() => {
  rmSync(workdir, {recursive: true, force: true});
});

describe('Phase 1 Package B named runtime regressions', () => {
  it('already_aborted_signal_cancels_before_process_start', async () => {
    const controller = new AbortController();
    controller.abort();
    const process = createControlledRuntimeProcess();
    let factoryCalls = 0;
    const executor = createDenoExecutor(
      createRuntimeConfig({working_dir: workdir}),
      createRegistry(async () => ({success: true, output: ''})),
      () => {
        factoryCalls += 1;
        return process;
      },
    );

    const result = await executor.execute('', '', {signal: controller.signal});

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('cancelled');
    expect(result.error).toBe('execution cancelled');
    expect(factoryCalls).toBe(0);
  });

  it('debug_frame_does_not_fail_empty_output_execution', async () => {
    const process = createControlledRuntimeProcess();
    const executor = createExecutorWithProcess(
      createRuntimeConfig({working_dir: workdir}),
      createRegistry(async () => ({success: true, output: ''})),
      process,
    );

    const execution = executor.execute('', '');
    await waitForProcessCapture(process);
    process.pushStdout(debugFrame('diagnostic only'));
    process.finish(0);

    const result = await execution;

    expect(result.success).toBe(true);
    expect(result.output).toBe('');
    expect(result.error).toBeNull();
  });

  it('queued_host_call_never_starts_after_timeout', async () => {
    const firstStarted = createDeferred<void>();
    const firstCompletion = createDeferred<ToolResult>();
    const started: Array<string> = [];
    const registry = createRegistry(async (_name, params) => {
      const callId = String(params['callId']);
      started.push(callId);
      if (callId === 'first') {
        firstStarted.resolve(undefined);
        return firstCompletion.promise;
      }
      throw new Error(`queued call started unexpectedly: ${callId}`);
    });
    const process = createControlledRuntimeProcess();
    const executor = createExecutorWithProcess(createRuntimeConfig({working_dir: workdir, code_timeout: 25}), registry, process);

    const execution = executor.execute('', '');
    await waitForProcessCapture(process);
    process.pushStdout(new Uint8Array([...toolCall('first'), ...toolCall('second')]));
    await firstStarted.promise;

    const result = await execution;

    expect(started).toEqual(['first']);
    expect(result.success).toBe(false);
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.tool_calls_made).toBe(2);
    expect(result.unresolved_call_count).toBe(1);
    expect(result.unresolved_call_ids).toEqual(['first']);
    expect(result.unresolved_call_count).toBeLessThanOrEqual(128);

    firstCompletion.resolve({success: true, output: 'late completion'});
  });

  it('cancelled_execution_cleanup_is_bounded', async () => {
    const handlerStarted = createDeferred<void>();
    const uncancellable = createDeferred<ToolResult>();
    const controller = new AbortController();
    const registry = createRegistry(async () => {
      handlerStarted.resolve(undefined);
      return uncancellable.promise;
    });
    const process = createControlledRuntimeProcess();
    const executor = createExecutorWithProcess(createRuntimeConfig({working_dir: workdir, code_timeout: 1_000}), registry, process);

    const execution = executor.execute('', '', {signal: controller.signal});
    await waitForProcessCapture(process);
    process.pushStdout(toolCall('cancelled'));
    await handlerStarted.promise;
    controller.abort();

    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.unresolved_call_ids).toEqual(['cancelled']);
    expect(process.observations.stdinAbortCount).toBeGreaterThanOrEqual(1);
    expect(process.observations.stdinAbortCount).toBeLessThanOrEqual(2);
    expect(process.observations.stdinEndCount).toBeGreaterThanOrEqual(1);
    expect(process.observations.stdinEndCount).toBeLessThanOrEqual(2);
    expect(process.observations.killed).toBe(true);
    expect(process.observations.stdoutCancelled).toBe(true);
    expect(process.observations.stderrCancelled).toBe(true);

    uncancellable.resolve({success: true, output: 'must not be published'});
  });

  it('late_host_completion_is_observed_only', async () => {
    const handlerStarted = createDeferred<void>();
    const lateCompletion = createDeferred<ToolResult>();
    let settlementObserved = false;
    const registry = createRegistry(async () => {
      handlerStarted.resolve(undefined);
      return lateCompletion.promise.then((value) => {
        settlementObserved = true;
        return value;
      });
    });
    const process = createControlledRuntimeProcess();
    const executor = createExecutorWithProcess(createRuntimeConfig({working_dir: workdir, code_timeout: 25}), registry, process);

    const execution = executor.execute('', '');
    await waitForProcessCapture(process);
    process.pushStdout(toolCall('late'));
    await handlerStarted.promise;
    const result = await execution;

    expect(result.output).toBe('');
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.unresolved_call_ids).toEqual(['late']);

    lateCompletion.resolve({success: true, output: 'late output that must not appear'});
    await lateCompletion.promise;
    await Promise.resolve();

    expect(settlementObserved).toBe(true);
    expect(result.output).toBe('');
    expect(result.unresolved_call_ids).toEqual(['late']);
  });

  it('runtime_raw_stream_budget_matrix', async () => {
    const encoder = new TextEncoder();
    const cases: ReadonlyArray<{readonly name: string; readonly relation: 'within' | 'exact' | 'over'}> = [
      {name: 'within-budget', relation: 'within'},
      {name: 'exact-boundary', relation: 'exact'},
      {name: 'over-budget', relation: 'over'},
    ];
    const limits: RuntimeLimits = {
      max_stdout_bytes: 8,
      max_stderr_bytes: 8,
      max_ipc_frame_bytes: 64,
      max_output_size: 128,
    };

    for (const testCase of cases) {
      const size = testCase.relation === 'within' ? limits.max_stdout_bytes - 1 : limits.max_stdout_bytes;
      const bytes = new Uint8Array(size + (testCase.relation === 'over' ? 1 : 0));
      if (bytes.byteLength > 0) bytes[bytes.byteLength - 1] = 10;
      const parser = createFrameParser('stdout', limits);
      if (testCase.relation === 'over') {
        expect(() => parser.push(bytes)).toThrow('stdout exceeds max raw byte size');
      } else {
        expect(parser.push(bytes)).toHaveLength(1);
        expect(parser.byteCount()).toBe(bytes.byteLength);
      }
      expect(`${testCase.name}`).toContain(testCase.relation);
    }

    const protocol = outputFrame('');
    const protocolLimits: RuntimeLimits = {...limits, max_stdout_bytes: protocol.byteLength};
    const protocolParser = createFrameParser('stdout', protocolLimits);
    expect(protocolParser.push(protocol)).toHaveLength(1);
    expect(protocolParser.byteCount()).toBe(protocol.byteLength);
    expect(() => protocolParser.push(encoder.encode('x'))).toThrow('stdout exceeds max raw byte size');

    const stderrProcess = createControlledRuntimeProcess();
    const stderrExecutor = createExecutorWithProcess(
      createRuntimeConfig({working_dir: workdir, max_stderr_bytes: 3}),
      createRegistry(async () => ({success: true, output: ''})),
      stderrProcess,
    );
    const stderrExecution = stderrExecutor.execute('', '');
    await waitForProcessCapture(stderrProcess);
    stderrProcess.pushStderr(encoder.encode('abc'));
    stderrProcess.finish(0);
    const stderrResult = await stderrExecution;
    expect(stderrResult.error).not.toContain('max raw byte size');

    const overStderrProcess = createControlledRuntimeProcess();
    const overStderrExecutor = createExecutorWithProcess(
      createRuntimeConfig({working_dir: workdir, max_stderr_bytes: 3}),
      createRegistry(async () => ({success: true, output: ''})),
      overStderrProcess,
    );
    const overStderrExecution = overStderrExecutor.execute('', '');
    await waitForProcessCapture(overStderrProcess);
    overStderrProcess.pushStderr(encoder.encode('abcd'));
    const overStderrResult = await overStderrExecution;
    expect(overStderrResult.error).toContain('stderr exceeds max raw byte size');

    const malformedProcess = createControlledRuntimeProcess();
    const malformedExecutor = createExecutorWithProcess(
      createRuntimeConfig({working_dir: workdir}),
      createRegistry(async () => ({success: true, output: ''})),
      malformedProcess,
    );
    const malformedExecution = malformedExecutor.execute('', '');
    await waitForProcessCapture(malformedProcess);
    malformedProcess.pushStdout(encoder.encode('{"type":"malformed"}\n'));
    const malformedResult = await malformedExecution;
    expect(malformedResult.success).toBe(false);
    expect(malformedResult.error).toContain('malformed nonempty IPC frame');
  });

  it('runtime_utf8_budget', () => {
    const value = JSON.stringify({type: '__output__', data: '😀'});
    const bytes = new TextEncoder().encode(`${value}\n`);
    const split = bytes.findIndex((byte, index) => index > 0 && byte >= 128);
    expect(split).toBeGreaterThan(0);
    const parser = createFrameParser('stdout', {
      max_stdout_bytes: bytes.byteLength,
      max_stderr_bytes: 32,
      max_ipc_frame_bytes: bytes.byteLength,
      max_output_size: 32,
    });
    const first = bytes.slice(0, split);
    const second = bytes.slice(split);
    expect(parser.push(first)).toHaveLength(0);
    const frames = parser.push(second);
    expect(frames).toHaveLength(1);
    expect(frames[0]?.text).toBe(value);
    expect(parser.byteCount()).toBe(bytes.byteLength);

    expect(() => appendUserOutput('', 'é', 3)).not.toThrow();
    expect(() => appendUserOutput('', 'éé', 4)).toThrow('output exceeds max size');
    expect(() => appendUserOutput('', '😀', 5)).not.toThrow();
    expect(() => appendUserOutput('', '😀', 4)).toThrow('output exceeds max size');
  });

  it('runtime_terminal_exit_frame_race', async () => {
    const firstStarted = createDeferred<void>();
    const firstCompletion = createDeferred<ToolResult>();
    const started: Array<string> = [];
    const registry = createRegistry(async (_name, params) => {
      const callId = String(params['callId']);
      started.push(callId);
      firstStarted.resolve(undefined);
      return firstCompletion.promise;
    });
    const process = createControlledRuntimeProcess();
    const executor = createExecutorWithProcess(createRuntimeConfig({working_dir: workdir}), registry, process);

    const execution = executor.execute('', '');
    await waitForProcessCapture(process);
    process.pushStdout(new Uint8Array([
      ...outputFrame('drained before exit'),
      ...toolCall('started'),
      ...toolCall('queued'),
    ]));
    process.finish(0);
    await firstStarted.promise;

    const result = await execution;

    expect(result.success).toBe(true);
    expect(result.output).toContain('drained before exit');
    expect(started).toEqual(['started']);
    expect(result.unresolved_call_ids).toEqual(['started']);

    firstCompletion.resolve({success: true, output: 'late'});
  });
});
