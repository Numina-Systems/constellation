// pattern: Imperative Shell
import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent.ts';
import type {AgentDependencies, ExternalEvent} from './types.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import {createToolRegistry} from '@/tool/registry.ts';
import type {ToolRegistry} from '@/tool/types.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import type {CheckpointAgentState} from './checkpoint-types.ts';
import type {ToolOutcome} from '@/contracts/outcomes.ts';

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

function text(text: string): ModelResponse { return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}}; }
function tool(...calls: ReadonlyArray<{id: string; name: string; input?: Record<string, unknown>}>): ModelResponse {
  return {content: calls.map((call) => ({type: 'tool_use' as const, id: call.id, name: call.name, input: call.input ?? {}})), stop_reason: 'tool_use', usage: {input_tokens: 1, output_tokens: 1}};
}
function fakeModel(responses: ReadonlyArray<ModelResponse>, log: Array<string> = []): ModelProvider {
  let index = 0;
  return {complete: async (request: ModelRequest) => {
    const last = request.messages.at(-1);
    log.push(typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content));
    const response = responses[index++];
    if (!response) throw new Error('fake provider exhausted');
    return response;
  }, stream: async function* () { yield {type: 'message_start' as const, message: {id: 'fake'}}; }};
}
function deps(overrides: Partial<AgentDependencies> = {}): AgentDependencies {
  const persistence = overrides.persistence ?? createInMemoryPersistence();
  const historyStore = overrides.historyStore ?? createConversationHistoryStore(persistence);
  const registry = overrides.registry ?? createToolRegistry();
  return {
    model: overrides.model ?? fakeModel([text('ok')]), memory: overrides.memory ?? memory(), registry,
    runtime: overrides.runtime ?? runtime(), persistence, historyStore,
    config: overrides.config ?? {max_tool_rounds: 5, context_budget: 0.8, model_max_tokens: 10000, max_tokens: 100},
    ...overrides,
  };
}
function register(registry: ToolRegistry, name: string, handler: (params: Record<string, unknown>) => Promise<{success: boolean; output: string; error?: string}>): void {
  registry.register({definition: {name, description: name, parameters: []}, handler});
}

const event = (content: string): ExternalEvent => ({source: 'test', content, metadata: {}, timestamp: new Date('2026-09-08T00:00:00Z')});

describe('Phase 3 slice 4 fake-level regressions', () => {
  it('mixed_ingress_serializes_complete_turns', async () => {
    const calls: string[] = [];
    const agent = createAgent(deps({model: fakeModel([text('one'), text('two'), text('three')], calls)}));
    const results = await Promise.all([agent.processMessage('one'), agent.processEvent(event('two')), agent.processMessage('three')]);
    expect(results).toEqual(['one', 'two', 'three']);
    expect(calls.map((call) => call === 'one' ? 'one' : call.endsWith('two') ? 'two' : 'three')).toEqual(['one', 'two', 'three']);
  });

  it('queue_failure_and_cancel_release', async () => {
    const calls: string[] = [];
    let modelCalls = 0;
    const model: ModelProvider = {complete: async (request) => { calls.push(String(request.messages.at(-1)?.content ?? '')); modelCalls++; if (modelCalls === 1) throw new Error('first model failed'); return text('later'); }, stream: async function* () { yield {type: 'message_start' as const, message: {id: 'fake'}}; }};
    const agent = createAgent(deps({model}));
    const first = agent.processMessage('first');
    const controller = new AbortController(); controller.abort();
    const cancelled = agent.processMessage('cancelled', {signal: controller.signal});
    const later = agent.processMessage('later');
    let firstError: unknown;
    try { await first; } catch (error) { firstError = error; }
    expect(firstError).toMatchObject({message: 'first model failed'});
    await expect(cancelled).rejects.toMatchObject({code: 'TURN_CANCELLED'});
    await expect(later).resolves.toBe('later');
    expect(calls).toEqual(['first', 'later']);
    const history = await agent.getConversationHistory();
    expect(history.some((message) => message.content === 'cancelled')).toBe(false);
  });

  it('registry_failures_reach_next_model_request', async () => {
    const persistence = createInMemoryPersistence();
    const registry = createToolRegistry();
    register(registry, 'fails', async () => ({success: false, output: 'success text containing error', error: 'typed_failure'}));
    const requests: ModelRequest[] = [];
    const model = fakeModel([tool({id: 'call-1', name: 'fails'}), text('done')]);
    const wrapped: ModelProvider = {complete: async (request) => { requests.push(request); return model.complete(request); }, stream: model.stream};
    const agent = createAgent(deps({persistence, registry, model: wrapped}));
    await expect(agent.processMessage('run')).resolves.toBe('done');
    const second = requests[1]?.messages.at(-1);
    expect(second?.role).toBe('user');
    expect(Array.isArray(second?.content) && second.content[0]).toMatchObject({type: 'tool_result', tool_use_id: 'call-1', is_error: true, content: 'success text containing error'});
  });

  it('tool_outcome_database_roundtrip', async () => {
    const persistence = createInMemoryPersistence();
    const registry = createToolRegistry();
    register(registry, 'fails', async () => ({success: false, output: 'success text containing error', error: 'typed_failure'}));
    const first = createAgent(deps({persistence, registry, model: fakeModel([tool({id: 'call-1', name: 'fails'}), text('done')])}));
    await first.processMessage('run');
    const second = createAgent(deps({persistence, registry, model: fakeModel([text('reloaded')])}), first.conversationId);
    const history = await second.getConversationHistory();
    const outcome = history.find((message) => message.role === 'tool')?.tool_outcome;
    expect(outcome).toMatchObject({kind: 'error', code: 'typed_failure'});
    await persistence.query('INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)', ['legacy', first.conversationId, 'tool', 'Error-looking success', null, 'legacy-call', null, new Date()]);
    const reloaded = await second.getConversationHistory();
    expect(reloaded.find((message) => message.id === 'legacy')?.tool_outcome).toMatchObject({kind: 'outcome_unknown', code: 'legacy_unknown'});
  });

  it('legacy_outcome_no_substring_inference', async () => {
    const persistence = createInMemoryPersistence();
    const registry = createToolRegistry();
    const agent = createAgent(deps({persistence, registry, model: fakeModel([text('ready')])}));
    await persistence.query('INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)', ['legacy', agent.conversationId, 'tool', 'Error-looking success', null, 'legacy-call', null, new Date()]);
    const history = await agent.getConversationHistory();
    expect(history.find((message) => message.id === 'legacy')?.tool_outcome).toMatchObject({kind: 'outcome_unknown', code: 'legacy_unknown'});
  });

  it('incomplete_batch_blocks_future_provider_calls', async () => {
    const persistence = createInMemoryPersistence();
    const registry = createToolRegistry();
    register(registry, 'one', async () => ({success: true, output: 'one'}));
    register(registry, 'two', async () => ({success: true, output: 'two'}));
    register(registry, 'three', async () => ({success: true, output: 'three'}));
    const calls: string[] = [];
    let dropped = false; let recovered = false;
    const lifecycle = {
      beginBatch: async () => 'batch', recordOutcome: async (_b: string, callId: string, _o: ToolOutcome) => { if (callId === 'call-2' && !dropped) { dropped = true; throw new Error('dropped connection'); } },
      completeBatch: async () => undefined, getRecoveryState: async () => recovered
        ? ({required: false, reason: null, batchId: null, unresolvedCallIds: []})
        : ({required: dropped, reason: dropped ? 'unresolved' : null, batchId: dropped ? 'batch' : null, unresolvedCallIds: dropped ? ['call-2', 'call-3'] : []}),
      recover: async () => { recovered = true; },
    };
    const agent = createAgent(deps({persistence, registry, integrityLifecycle: lifecycle, model: fakeModel([tool({id: 'call-1', name: 'one'}, {id: 'call-2', name: 'two'}, {id: 'call-3', name: 'three'})], calls)}));
    await expect(agent.processMessage('run')).rejects.toBeDefined();
    await expect(agent.processMessage('blocked')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(calls).toHaveLength(1);
    await expect(agent.recoverIntegrity?.(['call-2', 'call-3'])).resolves.toBeUndefined();
  });

  it('loop_halt_checkpoint_message_ids_are_durable', async () => {
    const captured: CheckpointAgentState[] = [];
    const loopDetector = {
      reset: () => undefined,
      check: () => ({triggered: true, similarity: 1, consecutiveCount: 3, action: 'halt' as const}),
    };
    const agent = createAgent(deps({
      model: fakeModel([text('repetitive')]),
      loopDetector,
      checkpointFn: async (_trigger, state) => { if (state) captured.push(state); return 'checkpoint'; },
      config: {max_tool_rounds: 2, context_budget: 0.8, checkpoint_interval: 1},
    }), 'loop-halt-durable');

    await expect(agent.processMessage('trigger loop halt')).resolves.toContain('stuck in a repetitive loop');

    const history = await agent.getConversationHistory();
    const durableIds = new Set(history.map((message) => message.id));
    expect(captured).toHaveLength(1);
    expect(captured[0]?.messageIds.length).toBeGreaterThan(0);
    expect(captured[0]?.messageIds.every((messageId) => durableIds.has(messageId))).toBe(true);
  });

  it('agent_checkpoint_real_trigger_matrix', async () => {
    const triggers: string[] = []; const snapshots: CheckpointAgentState[] = [];
    const ref = {current: {turnNumber: 0, toolRound: 0, messageIds: [], compactionMeta: {lastCompactedIndex: -1, summaryCount: 0}}};
    const checkpointFn = async (trigger: 'explicit' | 'pre_compaction' | 'shutdown' | 'interval', state?: CheckpointAgentState) => { triggers.push(trigger); if (state) snapshots.push(state); return 'checkpoint'; };
    const registry = createToolRegistry();
    register(registry, 'checkpoint', async () => ({success: true, output: 'ignored'}));
    const agent = createAgent(deps({registry, checkpointFn, checkpointStateRef: ref, config: {max_tool_rounds: 4, context_budget: 0.8, checkpoint_interval: 2}, model: fakeModel([tool({id: 'checkpoint-call', name: 'checkpoint'}), text('done'), text('second')])}));
    await agent.processMessage('first'); await agent.processMessage('second'); await agent.shutdown?.();
    expect(triggers).toEqual(['explicit', 'interval', 'shutdown']);
    expect(snapshots.every((snapshot) => Object.isFrozen(snapshot))).toBe(true);
    expect(snapshots[1]?.turnNumber).toBe(2);
  });

  it('resume_counter_and_interval_continuity', async () => {
    const triggers: string[] = []; const ref = {current: {turnNumber: 2, toolRound: 0, messageIds: [], compactionMeta: {lastCompactedIndex: -1, summaryCount: 0}}};
    const agent = createAgent(deps({checkpointStateRef: ref, checkpointFn: async (trigger) => {triggers.push(trigger); return 'ok';}, config: {max_tool_rounds: 2, context_budget: 0.8, checkpoint_interval: 3}, model: fakeModel([text('third')])}), 'resume');
    await agent.processMessage('third');
    expect(triggers).toEqual(['interval']);
    expect(agent.getCheckpointState()?.turnNumber).toBe(3);
  });

  it('interval_save_failure_does_not_fail_turn', async () => {
    const warnings: string[] = []; const original = console.warn; console.warn = (message: string) => warnings.push(message);
    try {
      const ref = {current: {turnNumber: 0, toolRound: 0, messageIds: [], compactionMeta: {lastCompactedIndex: -1, summaryCount: 0}}};
      const agent = createAgent(deps({checkpointStateRef: ref, checkpointFn: async () => { throw new Error('checkpoint store down'); }, config: {max_tool_rounds: 2, context_budget: 0.8, checkpoint_interval: 1}, model: fakeModel([text('ok')])}));
      await expect(agent.processMessage('ok')).resolves.toBe('ok');
      expect(agent.getCheckpointState()?.turnNumber).toBe(1); expect(warnings.join('\n')).toContain('checkpoint');
    } finally { console.warn = original; }
  });

  it('context_unfittable_has_zero_provider_calls', async () => {
    let calls = 0; const model = fakeModel([text('never')]);
    const wrapped: ModelProvider = {complete: async (request) => { calls++; return model.complete(request); }, stream: model.stream};
    const agent = createAgent(deps({model: wrapped, config: {max_tool_rounds: 2, context_budget: 0.8, model_max_tokens: 300, max_tokens: 300}}));
    await expect(agent.processMessage('x'.repeat(5000))).rejects.toMatchObject({code: 'CONTEXT_UNFITTABLE'});
    expect(calls).toBe(0);
  });

  it('agent_actual_context_pressure_matrix', async () => {
    let calls = 0;
    let promptBuilds = 0;
    const growingMemory: MemoryManager = {
      ...memory(),
      buildSystemPrompt: async () => {
        promptBuilds += 1;
        return promptBuilds === 1 ? 'system' : 's'.repeat(2000);
      },
    };
    const registry = createToolRegistry();
    register(registry, 'grow', async () => ({success: true, output: 'tool result'}));
    const provider = fakeModel([tool({id: 'grow-call', name: 'grow'}), text('must not reach provider')]);
    const model: ModelProvider = {
      complete: async (request) => { calls += 1; return provider.complete(request); },
      stream: provider.stream,
    };
    const agent = createAgent(deps({memory: growingMemory, registry, model,
      config: {max_tool_rounds: 3, context_budget: 0.8, model_max_tokens: 600, max_tokens: 50}}));
    await expect(agent.processMessage('grow context')).rejects.toMatchObject({code: 'CONTEXT_UNFITTABLE'});
    expect(calls).toBe(1);
    expect(promptBuilds).toBeGreaterThanOrEqual(2);
  });
});
