// pattern: Imperative Shell
import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import type {AgentDependencies} from './types.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import type {CompactionPreparationOptions, CompactionResult, Compactor} from '@/compaction/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import {createToolRegistry} from '@/tool/registry.ts';

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

function runtime(): CodeRuntime { return {execute: async () => ({success: true, output: '', error: null, tool_calls_made: 0, duration_ms: 0})}; }

function text(value: string): ModelResponse { return {content: [{type: 'text', text: value}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}; }

function fakeModel(responses: ReadonlyArray<ModelResponse>, onCall?: () => void): ModelProvider {
  let index = 0;
  return {
    complete: async (_request: ModelRequest) => {
      onCall?.();
      const response = responses[index++];
      if (!response) throw new Error('fake provider exhausted');
      return response;
    },
    stream: async function* () { yield {type: 'message_start' as const, message: {id: 'fake'}}; },
  };
}

// A context budget of one token forces compaction admission on the first round.
const tightConfig = {max_tool_rounds: 5, context_budget: 0.0001, model_max_tokens: 10000, max_tokens: 100};

function deps(overrides: Partial<AgentDependencies> & {readonly conversationId: string}): AgentDependencies {
  const {conversationId, ...rest} = overrides;
  const persistence = rest.persistence ?? createInMemoryPersistence();
  const historyStore = rest.historyStore ?? createConversationHistoryStore(persistence);
  return {
    model: rest.model ?? fakeModel([text('ok')]), memory: rest.memory ?? memory(),
    registry: rest.registry ?? createToolRegistry(), runtime: rest.runtime ?? runtime(),
    persistence, historyStore, config: rest.config ?? tightConfig, ...rest,
    integrityLifecycle: rest.integrityLifecycle ?? createIntegrityLifecycle(persistence, conversationId),
  };
}

function recordingCompactor(result: CompactionResult, calls: Array<CompactionPreparationOptions | undefined> = []): Compactor {
  return {
    consecutiveFailures: 0,
    compress: async (_history, _conversationId, options) => {
      calls.push(options);
      return result;
    },
  };
}

describe('Agent compaction ambiguity and cancellation propagation', () => {
  it('ambiguous_compaction_halts_turn_latches_durable_recovery_and_blocks_future_turns', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-ambiguous');
    let modelCalls = 0;
    const model = fakeModel([text('unreachable')], () => { modelCalls += 1; });
    const compactor = recordingCompactor({
      history: [], batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: 10, tokensEstimateAfter: 10,
      failed: true, failureCode: 'history_state_unknown', operationId: 'compaction-ambiguous', recoveryNote: 'committed truth is unknown',
    });
    const agent = createAgent(deps({conversationId: 'conv-ambiguous', persistence, integrityLifecycle: lifecycle, model, compactor}), 'conv-ambiguous');

    await expect(agent.processMessage('hello')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    // No provider call may run against a possibly superseded transcript.
    expect(modelCalls).toBe(0);
    // The latch is durable: a restart re-derives recovery-required from the receipt.
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // A freshly constructed agent (restart simulation) is blocked by durable state alone.
    const restarted = createAgent(deps({conversationId: 'conv-ambiguous', persistence, integrityLifecycle: lifecycle, model: fakeModel([text('blocked')]), compactor}), 'conv-ambiguous');
    await expect(restarted.processMessage('after restart')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(modelCalls).toBe(0);
    // Subsequent turns stay blocked through the in-memory latch as well.
    await expect(agent.processMessage('again')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(modelCalls).toBe(0);
  });

  it('store_level_committed_publication_faults_are_not_swallowed', async () => {
    const compactor: Compactor = {
      consecutiveFailures: 0,
      compress: async () => {
        const error = new Error('commit receipt established but publication failed') as Error & {readonly code: string};
        Object.defineProperty(error, 'code', {value: 'committed_publication_failed', enumerable: true});
        throw error;
      },
    };
    let modelCalls = 0;
    const model = fakeModel([text('unreachable')], () => { modelCalls += 1; });
    const agent = createAgent(deps({conversationId: 'conv-thrown', model, compactor}), 'conv-thrown');

    await expect(agent.processMessage('hello')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(modelCalls).toBe(0);
    await expect(agent.processMessage('again')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
  });

  it('compaction_forwards_turn_signal_and_deadline', async () => {
    const calls: Array<CompactionPreparationOptions | undefined> = [];
    const compactor = recordingCompactor({
      history: [], batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: 1, tokensEstimateAfter: 1,
    }, calls);
    const model = fakeModel([text('ok')]);
    const agent = createAgent(deps({conversationId: 'conv-forwarding', model, compactor}), 'conv-forwarding');

    const controller = new AbortController();
    const deadline = Date.now() + 60_000;
    await expect(agent.processMessage('hello', {signal: controller.signal, deadline})).resolves.toBe('ok');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.request?.signal).toBe(controller.signal);
    expect(calls[0]?.request?.deadline).toBe(deadline);
  });
});
