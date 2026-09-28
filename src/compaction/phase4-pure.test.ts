import {describe, expect, it} from 'bun:test';
import type {ConversationMessage} from '@/agent/types.ts';
import {createCompactionBreaker} from './breaker.ts';
import {deriveContinuation} from './continuation.ts';
import {groupConversationExchanges, projectExchangeGroup, selectCompactionGroups} from './grouping.ts';
import {createCompositionSeam} from '@/composition-seam.ts';
import {createCompactionRecoveryAction} from '@/index.ts';

function message(id: string, role: ConversationMessage['role'], content: string, time: number, extra: Partial<ConversationMessage> = {}): ConversationMessage {
  return {id, conversation_id: 'phase4', role, content, created_at: new Date(time), ...extra};
}

describe('Phase 4 pure compaction regressions', () => {
  it('summary_causal_order_and_span', () => {
    const history = [
      message('u', 'user', 'objective', 300),
      message('a', 'assistant', 'call', 500, {tool_calls: [{type: 'tool_use', id: 'c1', name: 'lookup', input: {query: 'x'}}]}),
      message('r', 'tool', 'ok', 100, {tool_call_id: 'c1', tool_outcome: {kind: 'success', output: 'ok'}}),
    ];
    const result = groupConversationExchanges(history);
    expect(result.error).toBeNull();
    const group = result.groups[1]!;
    expect(group.messages.map((item) => item.id)).toEqual(['a', 'r']);
    expect(group.startTime.getTime()).toBe(100);
    expect(group.endTime.getTime()).toBe(500);
    expect(projectExchangeGroup(group, 2).messages[0]?.content).toContain('c1 lookup');
  });

  it('continuation_preserves_objective_and_tool_status', () => {
    const history = [
      message('u', 'user', 'Build the importer. It must never retry effects.', 1),
      message('a', 'assistant', 'working', 2, {tool_calls: [{type: 'tool_use', id: 'c1', name: 'run', input: {}}]}),
      message('r', 'tool', 'failed', 3, {tool_call_id: 'c1', tool_outcome: {kind: 'error', code: 'failed', message: 'failed'}}),
    ];
    const continuation = deriveContinuation(history);
    expect(continuation.text).toContain('Build the importer');
    expect(continuation.text).toContain('c1: error/failed');
    expect(continuation.text).toContain('never retry effects');
  });

  it('importance selects whole exchange groups in durable order', () => {
    const history = [
      message('u1', 'user', 'ordinary', 1),
      message('a1', 'assistant', 'call', 2, {tool_calls: [{type: 'tool_use', id: 'c1', name: 'x', input: {}}]}),
      message('r1', 'tool', 'result', 3, {tool_call_id: 'c1'}),
      message('u2', 'user', 'recent', 4),
    ];
    const result = groupConversationExchanges(history);
    const selected = selectCompactionGroups(result.groups, 1);
    expect(selected.source.flatMap((group) => group.messages.map((item) => item.id))).toEqual(['u1', 'a1', 'r1']);
  });

  it('breaker_open_half_open_recovery', () => {
    let current = 0;
    const breaker = createCompactionBreaker({threshold: 1, cooldownMs: 60_000, clock: {now: () => current}});
    expect(breaker.allow()).toBe(true);
    breaker.recordFailure('transient');
    expect(breaker.allow()).toBe(false);
    current = 60_000;
    expect(breaker.allow()).toBe(true);
    expect(breaker.allow()).toBe(false);
    breaker.recordSuccess();
    expect(breaker.status().state).toBe('CLOSED');
  });

  it('breaker_permanent_fault_requires_reset', () => {
    const breaker = createCompactionBreaker({threshold: 3});
    expect(breaker.allow()).toBe(true);
    breaker.recordFailure('intervention');
    expect(breaker.status().interventionRequired).toBe(true);
    expect(breaker.allow()).toBe(false);
    breaker.reset();
    expect(breaker.allow()).toBe(true);
  });

  it('L-c serialized recovery action is seam-only and model-free', async () => {
    let resetCount = 0;
    const calls: string[] = [];
    const compactor = {
      consecutiveFailures: 2,
      status: () => { calls.push('status'); return {breaker: {state: 'OPEN' as const, consecutiveFailures: 2, openedAt: 1, interventionRequired: false}, consecutiveFailures: 2}; },
      reset: () => { calls.push('reset'); resetCount += 1; },
      compress: async () => ({history: [], batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: 0, tokensEstimateAfter: 0}),
    };
    const action = createCompactionRecoveryAction(compactor);
    const [status, reset, ignored] = await Promise.all([action('/compaction status'), action('/compaction reset'), action('/other')]);
    expect(status).toContain('compaction breaker: OPEN');
    expect(reset).toBe('compaction breaker reset');
    expect(ignored).toBeNull();
    expect(resetCount).toBe(1);
    expect(calls).toEqual(['status', 'reset']);
  });

  it('trusted_compaction_status_and_reset_are_seam_only', () => {
    let resetCount = 0;
    const compactor = {
      consecutiveFailures: 2,
      status: () => ({breaker: {state: 'OPEN' as const, consecutiveFailures: 2, openedAt: 1, interventionRequired: false}, consecutiveFailures: 2}),
      reset: () => { resetCount += 1; },
      compress: async () => ({history: [], batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: 0, tokensEstimateAfter: 0}),
    };
    const seam = createCompositionSeam();
    expect(seam.getCompactionStatus(compactor)?.breaker.state).toBe('OPEN');
    seam.resetCompactionBreaker(compactor);
    expect(resetCount).toBe(1);
  });
});
