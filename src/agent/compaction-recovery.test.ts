// pattern: Imperative Shell
import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import type {AgentDependencies, ConversationMessage} from './types.ts';
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

function toolUse(...calls: ReadonlyArray<{id: string; name: string; input?: Record<string, unknown>}>): ModelResponse {
  return {content: calls.map((call) => ({type: 'tool_use' as const, id: call.id, name: call.name, input: call.input ?? {}})), stop_reason: 'tool_use' as const, usage: {input_tokens: 1, output_tokens: 1}};
}

const normalConfig = {max_tool_rounds: 5, context_budget: 0.8, model_max_tokens: 10000, max_tokens: 100};

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

describe('Unresolved execution effects and interrupted batches', () => {
  it('execute_code_outcome_unknown_halts_turn_and_latches_recovery', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-unresolved');
    let modelCalls = 0;
    const model = fakeModel([toolUse({id: 'exec-1', name: 'execute_code', input: {code: 'await tools.memory_write()'}}), text('unreachable')], () => { modelCalls += 1; });
    const runtime: CodeRuntime = {execute: async () => ({success: false, output: '', error: 'unresolved host tool calls', tool_calls_made: 1, duration_ms: 5, outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-1'], unresolved_call_count: 1})};
    const registry = createToolRegistry();
    registry.register({definition: {name: 'execute_code', description: 'run code', parameters: []}, handler: async () => ({success: true, output: ''})});
    const agent = createAgent(deps({conversationId: 'conv-unresolved', model, runtime, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-unresolved');

    // The uncertain effect fails the turn closed: no further provider call may run.
    await expect(agent.processMessage('run code')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(modelCalls).toBe(1);
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // The transcript carries the typed uncertain outcome for the correlated call.
    const history = await agent.getConversationHistory();
    const resultMessage = history.find((item) => item.role === 'tool' && item.tool_call_id === 'exec-1');
    expect(resultMessage?.tool_outcome?.kind).toBe('outcome_unknown');
    // The lifecycle receipt records the same true outcome — not 'cancelled'.
    const receiptRows = await persistence.query<{readonly details: unknown}>(
      `SELECT details FROM operation_receipts WHERE operation_type = 'agent_batch' AND details->>'conversationId' = $1`, ['conv-unresolved'],
    );
    const outcomes = (Array.isArray(receiptRows) && receiptRows[0] !== undefined && typeof receiptRows[0].details === 'object' && receiptRows[0].details !== null
      ? (receiptRows[0].details as Record<string, unknown>)['outcomes']
      : undefined) as Record<string, {readonly kind?: string}> | undefined;
    expect(outcomes?.['exec-1']?.kind).toBe('outcome_unknown');
  });

  it('mid_batch_cancellation_backfills_transcript_results_and_next_turn_succeeds', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-cancel-batch');
    const controller = new AbortController();
    const registry = createToolRegistry();
    for (const name of ['first_tool', 'second_tool']) {
      registry.register({
        definition: {name, description: name, parameters: []},
        handler: async () => {
          if (name === 'first_tool') controller.abort();
          return {success: true, output: `${name} ok`};
        },
      });
    }
    const model = fakeModel([toolUse({id: 'call-1', name: 'first_tool'}, {id: 'call-2', name: 'second_tool'}), text('recovered')]);
    const agent = createAgent(deps({conversationId: 'conv-cancel-batch', model, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-cancel-batch');

    await expect(agent.processMessage('go', {signal: controller.signal})).rejects.toMatchObject({code: 'TURN_CANCELLED'});
    // The interrupted batch backfilled a correlated transcript row for the unstarted
    // call, so the next turn sees typed outcomes instead of EXCHANGE_CORRUPT.
    const history = await agent.getConversationHistory();
    expect(history.filter((item) => item.role === 'tool').map((item) => item.tool_call_id)).toEqual(['call-1', 'call-2']);
    await expect(agent.processMessage('continue')).resolves.toBe('recovered');
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: false});
  });

  it('transcript_backfill_failure_keeps_the_batch_recovery_required', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-backfill-fail');
    const historyStore = createConversationHistoryStore(persistence);
    let toolResultAppends = 0;
    const flakyHistoryStore = {
      ...historyStore,
      append: async (input: Parameters<typeof historyStore.append>[0]): Promise<ConversationMessage> => {
        if (input.role === 'tool') {
          toolResultAppends += 1;
          if (toolResultAppends >= 2) throw new Error('injected tool result write failure');
        }
        return historyStore.append(input);
      },
    };
    const controller = new AbortController();
    const registry = createToolRegistry();
    for (const name of ['first_tool', 'second_tool']) {
      registry.register({
        definition: {name, description: name, parameters: []},
        handler: async () => {
          if (name === 'first_tool') controller.abort();
          return {success: true, output: `${name} ok`};
        },
      });
    }
    const model = fakeModel([toolUse({id: 'call-1', name: 'first_tool'}, {id: 'call-2', name: 'second_tool'}), text('unreachable')]);
    const agent = createAgent(deps({conversationId: 'conv-backfill-fail', persistence, historyStore: flakyHistoryStore, model, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-backfill-fail');

    // The transcript backfill itself failed, so the batch stays recovery-required
    // instead of reporting complete with a transcript hole.
    await expect(agent.processMessage('go', {signal: controller.signal})).rejects.toMatchObject({code: 'TURN_CANCELLED'});
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    await expect(agent.processMessage('continue')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
  });

  it('outcome_unknown_stops_remaining_dispatch_and_backfills_as_cancelled', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-stop-dispatch');
    let modelCalls = 0;
    let regularInvocations = 0;
    const model = fakeModel([
      toolUse({id: 'exec-1', name: 'execute_code', input: {code: 'await tools.host_mutation()'}}, {id: 'call-2', name: 'regular_tool'}),
      text('unreachable'),
    ], () => { modelCalls += 1; });
    const runtime: CodeRuntime = {execute: async () => ({success: false, output: '', error: 'unresolved host tool calls', tool_calls_made: 1, duration_ms: 5, outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-1'], unresolved_call_count: 1})};
    const registry = createToolRegistry();
    registry.register({definition: {name: 'execute_code', description: 'run code', parameters: []}, handler: async () => ({success: true, output: ''})});
    registry.register({definition: {name: 'regular_tool', description: 'regular', parameters: []}, handler: async () => { regularInvocations += 1; return {success: true, output: 'must not run'}; }});
    const agent = createAgent(deps({conversationId: 'conv-stop-dispatch', model, runtime, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-stop-dispatch');

    await expect(agent.processMessage('go')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    // The uncertain effect stops the batch immediately: the queued tool never runs.
    expect(regularInvocations).toBe(0);
    expect(modelCalls).toBe(1);
    // The not-dispatched call is backfilled as a typed cancelled outcome.
    const history = await agent.getConversationHistory();
    const backfilled = history.find((item) => item.role === 'tool' && item.tool_call_id === 'call-2');
    expect(backfilled?.tool_outcome?.kind).toBe('cancelled');
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
  });

  it('uncertainty_marker_survives_cancellation_cleanup', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-uncertain-cancel');
    const controller = new AbortController();
    const model = fakeModel([
      toolUse({id: 'exec-1', name: 'execute_code'}, {id: 'call-2', name: 'later_tool'}),
      text('unreachable'),
    ]);
    const runtime: CodeRuntime = {
      execute: async () => {
        controller.abort();
        return {success: false, output: '', error: 'sandbox timed out on an uncancellable host mutation', tool_calls_made: 1, duration_ms: 5, outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-9'], unresolved_call_count: 1};
      },
    };
    const registry = createToolRegistry();
    registry.register({definition: {name: 'execute_code', description: 'run code', parameters: []}, handler: async () => ({success: true, output: ''})});
    registry.register({definition: {name: 'later_tool', description: 'later', parameters: []}, handler: async () => ({success: true, output: 'must not run'})});
    const agent = createAgent(deps({conversationId: 'conv-uncertain-cancel', model, runtime, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-uncertain-cancel');

    // Cancellation lands during the uncertain execution: cleanup backfills, completes
    // the batch, and must still preserve the durable unresolved-effect marker.
    await expect(agent.processMessage('go', {signal: controller.signal})).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // A restarted agent is blocked by durable state alone.
    const restarted = createAgent(deps({conversationId: 'conv-uncertain-cancel', persistence, integrityLifecycle: lifecycle, model: fakeModel([text('blocked')]), runtime, registry}), 'conv-uncertain-cancel');
    await expect(restarted.processMessage('after restart')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
  });

  it('uncertain_outcome_persistence_failure_still_fails_closed', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-append-fail');
    const historyStore = createConversationHistoryStore(persistence);
    let toolResultAppends = 0;
    const flakyHistoryStore = {
      ...historyStore,
      append: async (input: Parameters<typeof historyStore.append>[0]): Promise<ConversationMessage> => {
        if (input.role === 'tool') {
          toolResultAppends += 1;
          if (toolResultAppends === 1) throw new Error('injected uncertain outcome write failure');
        }
        return historyStore.append(input);
      },
    };
    let regularInvocations = 0;
    const registry = createToolRegistry();
    registry.register({definition: {name: 'execute_code', description: 'run code', parameters: []}, handler: async () => ({success: true, output: ''})});
    registry.register({definition: {name: 'later_tool', description: 'later', parameters: []}, handler: async () => { regularInvocations += 1; return {success: true, output: 'must not run'}; }});
    const model = fakeModel([toolUse({id: 'exec-1', name: 'execute_code'}, {id: 'call-2', name: 'later_tool'}), text('unreachable')]);
    const runtime: CodeRuntime = {execute: async () => ({success: false, output: '', error: 'unresolved host tool calls', tool_calls_made: 1, duration_ms: 5, outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-1'], unresolved_call_count: 1})};
    const agent = createAgent(deps({conversationId: 'conv-append-fail', persistence, historyStore: flakyHistoryStore, model, runtime, registry, integrityLifecycle: lifecycle, config: normalConfig}), 'conv-append-fail');

    // The uncertain outcome write fails once, but the effect must still fail closed:
    // no further dispatch, durable latch, and restart blocking.
    await expect(agent.processMessage('go')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(regularInvocations).toBe(0);
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    // The retried transcript append records the true outcome, not a cancelled stand-in.
    const history = await agent.getConversationHistory();
    const uncertainRow = history.find((item) => item.role === 'tool' && item.tool_call_id === 'exec-1');
    expect(uncertainRow?.tool_outcome?.kind).toBe('outcome_unknown');
    const restarted = createAgent(deps({conversationId: 'conv-append-fail', persistence, integrityLifecycle: lifecycle, model: fakeModel([text('blocked')]), runtime, registry}), 'conv-append-fail');
    await expect(restarted.processMessage('after restart')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
  });

  it('unconfirmed_uncertainty_marker_keeps_the_batch_unfinished', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-marker-fail');
    const failingMarkerLifecycle = {
      ...lifecycle,
      markConversationRecoveryRequired: async (): Promise<string> => {
        throw new Error('injected marker write failure');
      },
    };
    const historyStore = createConversationHistoryStore(persistence);
    const registry = createToolRegistry();
    registry.register({definition: {name: 'execute_code', description: 'run code', parameters: []}, handler: async () => ({success: true, output: ''})});
    const model = fakeModel([toolUse({id: 'exec-1', name: 'execute_code'}), text('unreachable')]);
    const runtime: CodeRuntime = {execute: async () => ({success: false, output: '', error: 'unresolved host tool calls', tool_calls_made: 1, duration_ms: 5, outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-1'], unresolved_call_count: 1})};
    const agent = createAgent(deps({conversationId: 'conv-marker-fail', historyStore, model, runtime, registry, integrityLifecycle: failingMarkerLifecycle, config: normalConfig}), 'conv-marker-fail');

    // Without a confirmed durable marker the original receipt itself is typed as an
    // unresolved-effect marker, so neither generic recovery nor a restarted agent
    // may clear the latch.
    await expect(agent.processMessage('go')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    await lifecycle.recover([], 'generic tool backfill');
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    const recoveredAgent = createAgent(deps({conversationId: 'conv-marker-fail', persistence, historyStore, model: fakeModel([text('blocked')]), runtime, registry, integrityLifecycle: lifecycle}), 'conv-marker-fail');
    await recoveredAgent.recoverIntegrity?.([], 'generic tool backfill');
    await expect(recoveredAgent.processMessage('after recovery')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    const restarted = createAgent(deps({conversationId: 'conv-marker-fail', persistence, historyStore, model: fakeModel([text('blocked')]), runtime, registry, integrityLifecycle: lifecycle}), 'conv-marker-fail');
    await expect(restarted.processMessage('after restart')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
  });
});
