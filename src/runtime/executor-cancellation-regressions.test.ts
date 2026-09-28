import {mkdtempSync, rmSync} from 'fs';
import {join} from 'path';
import {tmpdir} from 'os';
import {afterEach, beforeEach, describe, expect, it} from 'bun:test';

import type {AgentConfig, RuntimeConfig} from '@/config/schema.ts';
import {createDenoExecutor} from './executor.ts';
import type {ToolRegistry, ToolResult} from '@/tool/types.ts';
import {createControlledRuntimeProcess} from '@/testing/runtime-process.ts';
import {createDeferred} from '@/testing/deferred.ts';

// Cycle-7 regressions: host dispatch must receive an execution-owned signal, and
// nested custom-tool uncertainty must taint the outer execution.

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

function createRegistry(dispatch: (name: string, params: Record<string, unknown>, options?: unknown) => Promise<ToolResult>): ToolRegistry {
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

let workdir = '';

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), 'constellation-runtime-cycle7-'));
});

afterEach(() => {
  rmSync(workdir, {recursive: true, force: true});
});

describe('Cycle-7 runtime cancellation and uncertainty regressions', () => {
  it('timeout_aborts_started_cooperative_host_handler', async () => {
    const handlerStarted = createDeferred<void>();
    const handlerSettled = createDeferred<string>();
    const registry = createRegistry(async (_name, _params, options) => {
      handlerStarted.resolve(undefined);
      const signal = (options as {readonly signal?: AbortSignal} | undefined)?.signal;
      return new Promise<ToolResult>((resolve) => {
        if (signal !== undefined) {
          signal.addEventListener('abort', () => {
            handlerSettled.resolve('aborted');
            resolve({success: false, output: '', error: 'aborted'});
          }, {once: true});
        }
      });
    });
    const process = createControlledRuntimeProcess();
    const executor = createDenoExecutor(createRuntimeConfig({working_dir: workdir, code_timeout: 40}), registry, () => process);

    const execution = executor.execute('', '');
    await Promise.resolve();
    process.pushStdout(toolCall('cooperative'));
    await handlerStarted.promise;

    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.unresolved_call_ids).toEqual(['cooperative']);
    const observed = await Promise.race([
      handlerSettled.promise,
      new Promise<string>((resolve) => setTimeout(() => resolve('never-aborted'), 500)),
    ]);
    expect(observed).toBe('aborted');
  });

  it('nested_custom_tool_unknown_outcome_taints_outer_execution', async () => {
    const registry = createRegistry(async (_name, params) => ({
      success: false,
      output: '',
      error: 'nested runtime reported unresolved host effects',
      runtime_outcome: 'outcome_unknown' as const,
      unresolved_call_ids: [`inner-${String(params['callId'])}`],
    }));
    const process = createControlledRuntimeProcess();
    const executor = createDenoExecutor(createRuntimeConfig({working_dir: workdir}), registry, () => process);

    const execution = executor.execute('', '');
    await Promise.resolve();
    process.pushStdout(toolCall('outer-1'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    process.finish(0);

    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.unresolved_call_ids).toContain('nested:outer-1');
    expect(result.unresolved_call_ids).toContain('nested:inner-outer-1');
  });

  it('later_completion_cannot_erase_observed_nested_uncertainty', async () => {
    let callCount = 0;
    const registry = createRegistry(async (_name, params) => {
      callCount += 1;
      if (callCount === 1) {
        return {
          success: false,
          output: '',
          error: 'nested runtime reported unresolved host effects',
          runtime_outcome: 'outcome_unknown' as const,
          unresolved_call_ids: [String(params['callId'])],
        };
      }
      return {success: true, output: 'fine'};
    });
    const process = createControlledRuntimeProcess();
    const executor = createDenoExecutor(createRuntimeConfig({working_dir: workdir}), registry, () => process);

    const execution = executor.execute('', '');
    await Promise.resolve();
    process.pushStdout(new Uint8Array([...toolCall('dup'), ...toolCall('dup')]));
    await new Promise((resolve) => setTimeout(resolve, 25));
    process.finish(0);

    const result = await execution;

    expect(result.success).toBe(false);
    expect(result.outcome).toBe('outcome_unknown');
    expect(result.unresolved_call_ids).toContain('nested:dup');
  });
});
