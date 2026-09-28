import {describe, expect, it} from 'bun:test';
import {createAgent} from './agent.ts';
import {createIntegrityLifecycle} from './integrity-lifecycle.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence} from '@/testing/ports.ts';
import type {AgentDependencies} from './types.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import type {CodeRuntime} from '@/runtime/types.ts';
import {createToolRegistry} from '@/tool/registry.ts';

// Cycle-7 regressions: typed runtime outcomes behind custom tools must reach the
// agent's durable handling instead of degrading to ordinary dispatch errors.

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

function text(value: string): ModelResponse {
  return {content: [{type: 'text', text: value}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

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

function toolUse(...calls: ReadonlyArray<{id: string; name: string; input?: Record<string, unknown>}>): ModelResponse {
  return {content: calls.map((call) => ({type: 'tool_use' as const, id: call.id, name: call.name, input: call.input ?? {}})), stop_reason: 'tool_use' as const, usage: {input_tokens: 1, output_tokens: 1}};
}

const config = {max_tool_rounds: 5, context_budget: 0.8, model_max_tokens: 10000, max_tokens: 100};

function deps(conversationId: string, overrides: Partial<AgentDependencies>): AgentDependencies {
  const persistence = overrides.persistence ?? createInMemoryPersistence();
  return {
    model: overrides.model ?? fakeModel([text('ok')]), memory: memory(), registry: overrides.registry ?? createToolRegistry(), runtime: runtime(),
    persistence, historyStore: createConversationHistoryStore(persistence), config, ...overrides,
    integrityLifecycle: overrides.integrityLifecycle ?? createIntegrityLifecycle(persistence, conversationId),
  };
}

describe('Custom tool typed runtime outcomes', () => {
  it('custom_tool_outcome_unknown_halts_turn_and_latches_recovery', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-custom-unknown');
    let modelCalls = 0;
    const model = fakeModel([toolUse({id: 'custom-1', name: 'report_tool', input: {}}), text('unreachable')], () => { modelCalls += 1; });
    const registry = createToolRegistry();
    registry.register({
      definition: {name: 'report_tool', description: 'custom tool', parameters: []},
      handler: async () => ({success: false, output: '', error: 'execution outcome unknown', runtime_outcome: 'outcome_unknown', unresolved_call_ids: ['host-call-9']}),
    });
    const agent = createAgent(deps('conv-custom-unknown', {model, registry, integrityLifecycle: lifecycle}), 'conv-custom-unknown');

    await expect(agent.processMessage('run the custom tool')).rejects.toMatchObject({code: 'RECOVERY_REQUIRED'});
    expect(modelCalls).toBe(1);
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: true});
    const history = await agent.getConversationHistory();
    const toolRows = history.filter((item) => item.role === 'tool');
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0]).toMatchObject({tool_call_id: 'custom-1', tool_outcome: {kind: 'outcome_unknown', code: 'runtime_outcome_unknown'}});
  });

  it('custom_tool_runtime_cancelled_is_recorded_without_latching', async () => {
    const persistence = createInMemoryPersistence();
    const lifecycle = createIntegrityLifecycle(persistence, 'conv-custom-cancel');
    const model = fakeModel([toolUse({id: 'custom-1', name: 'report_tool', input: {}}), text('done')]);
    const registry = createToolRegistry();
    registry.register({
      definition: {name: 'report_tool', description: 'custom tool', parameters: []},
      handler: async () => ({success: false, output: '', error: 'tool execution cancelled', runtime_outcome: 'cancelled'}),
    });
    const agent = createAgent(deps('conv-custom-cancel', {model, registry, integrityLifecycle: lifecycle}), 'conv-custom-cancel');

    await expect(agent.processMessage('go')).resolves.toBe('done');
    const history = await agent.getConversationHistory();
    const toolRows = history.filter((item) => item.role === 'tool');
    expect(toolRows[0]).toMatchObject({tool_call_id: 'custom-1', tool_outcome: {kind: 'cancelled'}});
    await expect(lifecycle.getRecoveryState()).resolves.toMatchObject({required: false});
  });
});
