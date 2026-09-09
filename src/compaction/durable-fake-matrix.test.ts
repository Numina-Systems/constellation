import {describe, expect, it} from 'bun:test';
import type {ConversationMessage} from '@/agent/types.ts';
import type {MemoryManager} from '@/memory/manager.ts';
import {createConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {createInMemoryPersistence, type TestPersistence} from '@/testing/ports.ts';
import type {ModelProvider, ModelRequest, ModelResponse} from '@/model/types.ts';
import {ModelError} from '@/model/types.ts';
import {createCompactor} from './compactor.ts';

function memory(): MemoryManager {
  return {
    getCoreBlocks: async () => [], getWorkingBlocks: async () => [], buildSystemPrompt: async () => '', read: async () => [],
    write: async () => ({applied: false, error: 'unused'}), list: async () => [], deleteBlock: async () => undefined,
    moveBlock: async () => { throw new Error('unused'); }, getStats: async () => ({tier: 'all', block_count: 0, total_bytes: 0}),
    getPendingMutations: async () => [], approveMutation: async () => { throw new Error('unused'); },
    rejectMutation: async () => { throw new Error('unused'); },
  };
}

function response(text: string): ModelResponse {
  return {content: [{type: 'text', text}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}};
}

function message(id: string, conversationId: string, role: ConversationMessage['role'], content: string, time: number): Readonly<Parameters<ReturnType<typeof createConversationHistoryStore>['append']>[0]> {
  return {id, conversation_id: conversationId, role, content, created_at: new Date(time)};
}

async function setup(options?: Readonly<{responses?: ReadonlyArray<ModelResponse | Error>; config?: Partial<Parameters<typeof createCompactor>[0]['config']>; onComplete?: (persistence: TestPersistence) => void | Promise<void>; clock?: {now(): number}; sleep?: (milliseconds: number) => Promise<void>; extraPairs?: number}>) {
  const persistence = createInMemoryPersistence();
  const historyStore = createConversationHistoryStore(persistence);
  const conversationId = `durable-${crypto.randomUUID()}`;
  let nextSource = 1;
  const appendPair = async (prefix: string): Promise<void> => {
    await historyStore.append(message(`${prefix}-user`, conversationId, 'user', `Build ${prefix}`, nextSource++));
    await historyStore.append(message(`${prefix}-assistant`, conversationId, 'assistant', `working ${prefix}`, nextSource++));
  };
  await appendPair('source');
  for (let pair = 0; pair < (options?.extraPairs ?? 0); pair += 1) await appendPair(`extra-${pair}`);
  const calls: Array<ModelRequest> = [];
  let index = 0;
  const responses = options?.responses ?? [response('summary')];
  const model: ModelProvider = {
    complete: async (request) => {
      calls.push(request);
      await options?.onComplete?.(persistence);
      const next = responses[Math.min(index++, responses.length - 1)];
      if (next instanceof Error) throw next;
      return next ?? response('summary');
    },
    stream: async function* () { yield {type: 'message_stop', message: {stop_reason: 'end_turn'}}; },
  };
  const base = {chunkSize: 2, keepRecent: 0, maxSummaryTokens: 32, clipFirst: 0, clipLast: 0, prompt: null, maxRetries: 2, ...options?.config};
  const compactor = createCompactor({model, memory: memory(), persistence, historyStore, config: base, modelName: 'fake', clock: options?.clock, sleep: options?.sleep});
  return {persistence, historyStore, conversationId, compactor, calls};
}

async function activeSourceIds(historyStore: ReturnType<typeof createConversationHistoryStore>, conversationId: string): Promise<ReadonlyArray<string>> {
  return (await historyStore.readActive(conversationId)).messages.map((item) => item.id);
}

describe('Phase 4 durable compactor fake-level matrices', () => {
  it('summary_empty_output_single_cycle_matrix', async () => {
    for (const empty of ['', '   ', response('') as ModelResponse, {content: [{type: 'tool_use', id: 'x', name: 'noop', input: {}}], stop_reason: 'end_turn', usage: {input_tokens: 1, output_tokens: 1}} as ModelResponse]) {
      const setupResult = await setup({responses: Array.from({length: 4}, () => empty instanceof Error ? empty : (typeof empty === 'string' ? response(empty) : empty))});
      const before = await activeSourceIds(setupResult.historyStore, setupResult.conversationId);
      const result = await setupResult.compactor.compress([], setupResult.conversationId);
      expect(result.failed).toBe(true);
      expect(result.failureCode).toBe('summary_empty');
      expect(await activeSourceIds(setupResult.historyStore, setupResult.conversationId)).toEqual(before);
      expect((await setupResult.persistence.query('SELECT operation_id FROM operation_receipts WHERE operation_id = $1', [result.operationId ?? 'missing']))).toEqual([]);
    }
  });

  it('summary_fit_matrix_single_cycle_gate', async () => {
    const setupResult = await setup({config: {contextWindow: 64, safetyMargin: 8}});
    const before = await activeSourceIds(setupResult.historyStore, setupResult.conversationId);
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failed).toBe(true);
    expect(result.failureCode).toBe('unfittable');
    expect(setupResult.calls).toHaveLength(0);
    expect(await activeSourceIds(setupResult.historyStore, setupResult.conversationId)).toEqual(before);
  });

  it('compaction_deadline_cancel_retry_matrix', async () => {
    const canceled = await setup({responses: [new ModelError('CANCELLED', 'caller canceled')]});
    const controller = new AbortController();
    controller.abort();
    const canceledResult = await canceled.compactor.compress([], canceled.conversationId, {request: {signal: controller.signal}});
    expect(canceledResult.failureCode).toBe('cancelled');
    expect(canceled.calls).toHaveLength(0);

    const retry = await setup({responses: [new ModelError('TIMEOUT', 'transient', true), new ModelError('TIMEOUT', 'transient', true), new ModelError('TIMEOUT', 'transient', true)]});
    const retryResult = await retry.compactor.compress([], retry.conversationId);
    expect(retryResult.failureCode).toBe('deadline_exceeded');
    expect(retry.calls).toHaveLength(3);
    expect(await activeSourceIds(retry.historyStore, retry.conversationId)).toEqual(['source-user', 'source-assistant']);
  });

  it('compaction_write_failure_reload_matrix', async () => {
    const setupResult = await setup();
    const before = await setupResult.historyStore.readActive(setupResult.conversationId);
    setupResult.persistence.failures.push({operation: 'query', error: new Error('injected write failure'), when: 'inside_transaction'});
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failed).toBe(true);
    expect(await setupResult.historyStore.readActive(setupResult.conversationId)).toEqual(before);
  });

  it('compaction_commit_ack_reconciliation', async () => {
    const setupResult = await setup();
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failureCode).toBeUndefined();
    expect(result.failed).toBeUndefined();
    expect(result.revision).toBe(3);
    expect((await setupResult.historyStore.readActive(setupResult.conversationId)).revision).toBe(3);
  });

  it('recursive_replacement_failure_retains_sources', async () => {
    let modelCalls = 0;
    const setupResult = await setup({config: {chunkSize: 1, clipFirst: 0, clipLast: 0}, onComplete: (persistence) => { modelCalls += 1; if (modelCalls > 4) persistence.failures.push({operation: 'commit', error: new Error('recursive replacement failed'), commandTag: 'ROLLBACK'}); }});
    await setupResult.historyStore.append(message('source-3', setupResult.conversationId, 'user', 'follow up', 3));
    await setupResult.historyStore.append(message('source-4', setupResult.conversationId, 'assistant', 'done', 4));
    const before = await activeSourceIds(setupResult.historyStore, setupResult.conversationId);
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failed).toBe(true);
    expect(await activeSourceIds(setupResult.historyStore, setupResult.conversationId)).toEqual(before);
    expect(await setupResult.historyStore.readHistorical(setupResult.conversationId, 20)).toHaveLength(4);
  });

  it('two_cycle_durable_history_carries_prior_clip_and_supersedes_lineage', async () => {
    const first = await setup({responses: [response('cycle-one-clip')]});
    const firstResult = await first.compactor.compress([], first.conversationId);
    expect(firstResult.failed).not.toBe(true);
    const firstSummary = (await first.historyStore.readActive(first.conversationId)).messages.find((item) => item.role === 'system');
    expect(firstSummary?.content).toContain('cycle-one-clip');
    const second = await setup({responses: [response('cycle-two-clip')]});
    // Reuse the same durable store/history as a real second cycle and append new active work.
    await first.historyStore.append(message('cycle-two-user', first.conversationId, 'user', 'cycle two objective', 3));
    await first.historyStore.append(message('cycle-two-assistant', first.conversationId, 'assistant', 'cycle two work', 4));
    const secondCalls: ModelRequest[] = [];
    const secondModel: ModelProvider = {complete: async (request) => { secondCalls.push(request); return response('cycle-two-clip'); }, stream: second.compactor.compress.bind(second.compactor) as never};
    void secondModel;
    let capturedSupersedes: string | null | undefined;
    const secondHistoryStore = {...first.historyStore, commitCompaction: async (plan: Parameters<typeof first.historyStore.commitCompaction>[0]) => {
      capturedSupersedes = plan.supersedesOperationId;
      return first.historyStore.commitCompaction(plan);
    }};
    const secondResult = await createCompactor({model: {complete: async (request) => { secondCalls.push(request); return response('cycle-two-clip'); }, stream: async function* () { yield {type: 'message_stop' as const, message: {stop_reason: 'end_turn' as const}}; }}, memory: memory(), persistence: first.persistence, historyStore: secondHistoryStore, config: {chunkSize: 2, keepRecent: 0, maxSummaryTokens: 32, clipFirst: 0, clipLast: 0, prompt: null, maxRetries: 0}, modelName: 'fake'}).compress([], first.conversationId);
    const result = await secondResult;
    expect(result.failed).not.toBe(true);
    expect(secondCalls[0]?.messages.some((item) => typeof item.content === 'string' && item.content.includes('cycle-one-clip'))).toBe(true);
    expect(capturedSupersedes).toBe(firstResult.operationId);
    expect((await first.historyStore.readActive(first.conversationId)).messages.at(-1)?.content).toContain('cycle-two-clip');
  });

  it('summary_empty_output_matrix_initial_recursive', async () => {
    const setupResult = await setup({extraPairs: 3, responses: Array.from({length: 20}, () => response(''))});
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failed).toBe(true);
    expect(result.failureCode).toBe('summary_empty');
    expect(setupResult.calls.some((request) => request.messages.some((item) => typeof item.content === 'string' && item.content.includes('Summary batch:')))).toBe(false);
  });

  it('summary_fit_matrix_initial_recursive', async () => {
    const setupResult = await setup({extraPairs: 3, config: {contextWindow: 64, safetyMargin: 8}});
    const result = await setupResult.compactor.compress([], setupResult.conversationId);
    expect(result.failed).toBe(true);
    expect(result.failureCode).toBe('unfittable');
    expect(setupResult.calls).toHaveLength(0);
  });

  it('compaction_deadline_cancel_retry_matrix', async () => {
    let current = 100;
    const sleeps: number[] = [];
    const setupResult = await setup({responses: [new ModelError('TIMEOUT', 'retry', true), new ModelError('TIMEOUT', 'retry', true)], config: {maxRetries: 2, backoffBaseMs: 5}, clock: {now: () => current}, sleep: async (milliseconds) => { sleeps.push(milliseconds); current = 200; }});
    const result = await setupResult.compactor.compress([], setupResult.conversationId, {request: {deadline: 150}});
    expect(result.failureCode).toBe('deadline_exceeded');
    expect(setupResult.calls).toHaveLength(1);
    expect(sleeps).toEqual([5]);
  });

  it('history_stale_membership_maps_to_intervention_latch', async () => {
    const setupResult = await setup();
    const staleStore = {...setupResult.historyStore, enumerateCompactionSources: async (conversationId: string, limit: number) => {
      const sources = await setupResult.historyStore.enumerateCompactionSources(conversationId, limit);
      await setupResult.persistence.query('DELETE FROM conversation_history_membership WHERE conversation_id = $1', [conversationId]);
      return sources;
    }};
    const staleCompactor = createCompactor({model: {complete: async () => response('unused'), stream: async function* () { yield {type: 'message_stop' as const, message: {stop_reason: 'end_turn' as const}}; }}, memory: memory(), persistence: setupResult.persistence, historyStore: staleStore, config: {chunkSize: 2, keepRecent: 0, maxSummaryTokens: 32, clipFirst: 0, clipLast: 0, prompt: null, maxRetries: 0}, modelName: 'fake'});
    const result = await staleCompactor.compress([], setupResult.conversationId);
    expect(result.failureCode).toBe('history_stale_membership');
    expect(staleCompactor.status?.().breaker.interventionRequired).toBe(true);
  });

  it('committed_publication_failed_records_success_and_recovery_note', async () => {
    const setupResult = await setup();
    const publishingStore = {...setupResult.historyStore, commitCompaction: async (plan: Parameters<typeof setupResult.historyStore.commitCompaction>[0]) => {
      const committed = await setupResult.historyStore.commitCompaction(plan);
      const error = new Error('publication failed') as Error & {code: string};
      Object.defineProperty(error, 'code', {value: 'committed_publication_failed', enumerable: true});
      throw error;
      return committed;
    }};
    const compactor = createCompactor({model: {complete: async () => response('summary'), stream: async function* () { yield {type: 'message_stop' as const, message: {stop_reason: 'end_turn' as const}}; }}, memory: memory(), persistence: setupResult.persistence, historyStore: publishingStore, config: {chunkSize: 2, keepRecent: 0, maxSummaryTokens: 32, clipFirst: 0, clipLast: 0, prompt: null, maxRetries: 0}, modelName: 'fake'});
    const result = await compactor.compress([], setupResult.conversationId);
    expect(result.failureCode).toBe('history_state_unknown');
    expect(result.recoveryNote).toContain('receipt established');
    expect(compactor.status?.().breaker.interventionRequired).toBe(false);
    expect((await setupResult.historyStore.readActive(setupResult.conversationId)).messages.some((item) => item.role === 'system')).toBe(true);
  });
});
