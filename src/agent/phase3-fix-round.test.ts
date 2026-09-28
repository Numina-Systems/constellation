import {describe, expect, it} from 'bun:test';
import {AgentError} from '@/errors/agent.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createAgent} from './agent.ts';
import {createToolRegistry} from '@/tool/registry.ts';
import type {AgentDependencies} from './types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import {ModelError} from '@/errors/model.ts';
import type {Compactor} from '@/compaction/types.ts';

function memory(): MemoryManager {
  return {
    getCoreBlocks: async () => [], getWorkingBlocks: async () => [], buildSystemPrompt: async () => 'system',
    read: async () => [], write: async () => ({applied: false, error: 'unused'}), list: async () => [],
    deleteBlock: async () => undefined, moveBlock: async () => { throw new Error('unused'); },
    getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}),
    getPendingMutations: async () => [], approveMutation: async () => { throw new Error('unused'); },
    rejectMutation: async () => { throw new Error('unused'); },
  };
}

function runtime(): CodeRuntime {
  return {execute: async () => ({success: true, output: '', error: null, tool_calls_made: 0, duration_ms: 0})};
}

function response(text: string): ModelResponse {
  return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

function compactRequest(): ModelResponse {
  return {
    content: [{type: 'tool_use', id: 'compact-call', name: 'compact_context', input: {}}],
    stop_reason: 'tool_use', usage: {input_tokens: 1, output_tokens: 1},
  };
}

function model(responses: ReadonlyArray<ModelResponse>, requests: Array<ModelRequest>): ModelProvider {
  let index = 0;
  return {
    complete: async (request) => {
      requests.push(request);
      const next = responses[index++];
      if (!next) throw new Error('fake provider exhausted');
      return next;
    },
    stream: async function* () { yield {type: 'message_start' as const, message: {id: 'fix-round'}}; },
  };
}

function agentDependencies(
  persistence: ReturnType<typeof createInMemoryPersistence>,
  modelProvider: ModelProvider,
  compactor?: Compactor,
): AgentDependencies {
  return {
    model: modelProvider, memory: memory(), registry: createToolRegistry(), runtime: runtime(), persistence,
    historyStore: createConversationHistoryStore(persistence),
    config: {max_tool_rounds: 4, context_budget: 0.8, model_max_tokens: 10_000, max_tokens: 100},
    compactor,
    classifiedProviders: [{name: 'dynamic', classification: 'dynamic', provider: () => 'stable context'}],
  };
}

describe('Phase 3 fix-round lifecycle regressions', () => {
  it('request_compaction_coalesces_and_consume_is_idempotent', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'intent-conversation');

    await lifecycle.requestCompaction?.();
    await lifecycle.requestCompaction?.();

    const intents = Array.from(persistence.rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_type'] === 'compaction_intent');
    expect(intents).toHaveLength(1);
    expect(await lifecycle.consumeCompactionIntent?.()).toBe(true);
    expect(await lifecycle.consumeCompactionIntent?.()).toBe(false);
  });

  it('compaction_intent_survives_restart_and_is_consumed_once', async () => {
    const persistence = createInMemoryPersistence();
    const first = createIntegrityLifecycle(persistence, 'restart-intent');
    await first.requestCompaction?.();

    const restarted = createIntegrityLifecycle(persistence, 'restart-intent');
    expect(await restarted.consumeCompactionIntent?.()).toBe(true);
    const third = createIntegrityLifecycle(persistence, 'restart-intent');
    expect(await third.consumeCompactionIntent?.()).toBe(false);
  });

  it('completed_turn_counter_is_durable_monotonic_and_typed', async () => {
    const persistence = createInMemoryPersistence();
    const first = createIntegrityLifecycle(persistence, 'counter-conversation');
    expect(await first.getCompletedTurnCount?.()).toBe(0);
    await first.recordCompletedTurn?.(3);
    await first.recordCompletedTurn?.(2);

    const restarted = createIntegrityLifecycle(persistence, 'counter-conversation');
    expect(await restarted.getCompletedTurnCount?.()).toBe(3);
    await expect(restarted.recordCompletedTurn?.(-1)).rejects.toMatchObject({
      code: 'INTEGRITY_FAILED',
      subsystem: 'agent',
    });
  });

  it('integrity_validation_failures_are_typed_agent_errors', async () => {
    const lifecycle = createIntegrityLifecycle(createInMemoryPersistence(), 'typed-errors');
    await expect(lifecycle.beginBatch([])).rejects.toBeInstanceOf(AgentError);
    await expect(lifecycle.recordOutcome('missing', 'call', {kind: 'success', output: 'x'}))
      .rejects.toMatchObject({code: 'INTEGRITY_FAILED'});
    await expect(lifecycle.completeBatch('missing')).rejects.toMatchObject({code: 'INTEGRITY_FAILED'});
    await expect(lifecycle.markRecoveryRequired?.('missing', 'test')).rejects.toMatchObject({code: 'INTEGRITY_FAILED'});
  });

  it('cancel_mid_provider_call_surfaces_typed_cancelled', async () => {
    const controller = new AbortController();
    let providerStarted = false;
    const provider: ModelProvider = {
      complete: async () => {
        providerStarted = true;
        await new Promise<void>((resolve) => {
          controller.signal.addEventListener('abort', () => resolve(), {once: true});
        });
        throw new ModelError('CANCELLED', 'provider call cancelled', false);
      },
      stream: async function* () { yield {type: 'message_start' as const, message: {id: 'cancelled'}}; },
    };
    const agent = createAgent(agentDependencies(createInMemoryPersistence(), provider), 'cancelled-provider');
    const pending = agent.processMessage('cancel me', {signal: controller.signal});
    while (!providerStarted) await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({code: 'CANCELLED'});
  });

  it('resume_counter_and_interval_continuity_from_durable_lifecycle', async () => {
    const persistence = createInMemoryPersistence();
    const previous = createIntegrityLifecycle(persistence, 'durable-counter-agent');
    await previous.recordCompletedTurn?.(2);
    const triggers: Array<string> = [];
    const lifecycle = createIntegrityLifecycle(persistence, 'durable-counter-agent');
    const agent = createAgent({...agentDependencies(persistence, model([response('third')], [])), integrityLifecycle: lifecycle,
      checkpointFn: async (trigger) => { triggers.push(trigger); return 'checkpoint'; },
      config: {max_tool_rounds: 2, context_budget: 0.8, checkpoint_interval: 3}}, 'durable-counter-agent');
    await expect(agent.processMessage('third')).resolves.toBe('third');
    expect(triggers).toEqual(['interval']);
    expect(await lifecycle.getCompletedTurnCount?.()).toBe(3);
  });

  it('cache_state_publishes_only_after_commit', async () => {
    const persistence = createInMemoryPersistence();
    const requests: Array<ModelRequest> = [];
    const compactor: Compactor = {
      consecutiveFailures: 0,
      compress: async (history) => ({
        history,
        batchesCreated: 0,
        messagesCompressed: 1,
        tokensEstimateBefore: 10,
        tokensEstimateAfter: 10,
        failed: true,
      }),
    };
    const agent = createAgent(
      agentDependencies(persistence, model([compactRequest(), response('done')], requests), compactor),
      'cache-commit-conversation',
    );

    await expect(agent.processMessage('request compaction')).resolves.toBe('done');
    expect(requests).toHaveLength(2);
    const firstRequest = JSON.stringify(requests[0]);
    const secondRequest = JSON.stringify(requests[1]);
    expect(firstRequest).toContain('Dynamic Context');
    expect(secondRequest).not.toContain('Dynamic Context');
  });
});
