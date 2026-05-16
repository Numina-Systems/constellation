import { describe, it, expect } from 'bun:test';
import { ConstellationError } from './base.js';
import { traceError } from './trace.js';
import type { TraceRecorder, OperationTrace } from '@/reflexion/types.js';

describe('traceError', () => {
  function createMockRecorder() {
    const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
    const recorder: TraceRecorder = {
      record: async (trace) => {
        traces.push(trace);
      },
    };
    return { recorder, traces };
  }

  it('AC5.1: calls recorder.record with toolName equal to error subsystem', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'memory operation failed',
      'INVALID_QUERY',
      'memory',
      {}
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    // Wait for async operation
    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.toolName).toBe('memory');
  });

  it('AC5.1: sets input.errorCode and input.subsystem', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'model operation failed',
      'RATE_LIMITED',
      'model',
      { retryAfter: 60 }
    );

    traceError(error, recorder, 'test-owner', 'conversation-456');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    const input = traces[0]!.input as Record<string, unknown>;
    expect(input['errorCode']).toBe('RATE_LIMITED');
    expect(input['subsystem']).toBe('model');
  });

  it('AC5.2: includes error context in input.context', async () => {
    const { recorder, traces } = createMockRecorder();
    const context = { attempt: 1, maxRetries: 3, userDetails: { id: 'user-789' } };
    const error = new ConstellationError(
      'retrieval failed',
      'FETCH_ERROR',
      'memory',
      context
    );

    traceError(error, recorder, 'test-owner', 'conversation-789');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    const input = traces[0]!.input as Record<string, unknown>;
    expect(input['context']).toEqual(context);
  });

  it('AC5.2: outputSummary contains toDisplayString() output', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'agent failed to process',
      'AGENT_ERROR',
      'agent',
      {},
      { suggestion: 'Try again later' }
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.outputSummary).toBe('[agent:AGENT_ERROR] agent failed to process — Suggestion: Try again later');
  });

  it('truncates output longer than 500 characters with ... suffix', async () => {
    const { recorder, traces } = createMockRecorder();
    const longMessage = 'a'.repeat(600);
    const error = new ConstellationError(
      longMessage,
      'LONG_ERROR',
      'test',
      {}
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    const summary = traces[0]!.outputSummary;
    expect(summary.length).toBe(500);
    expect(summary.endsWith('...')).toBe(true);
  });

  it('sets success to false', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'test error',
      'TEST_ERROR',
      'test',
      {}
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.success).toBe(false);
  });

  it('sets error field to full display string', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'test failed',
      'TEST_CODE',
      'test-subsystem',
      {}
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.error).toBe('[test-subsystem:TEST_CODE] test failed');
  });

  it('sets durationMs to 0', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'test error',
      'TEST_ERROR',
      'test',
      {}
    );

    traceError(error, recorder, 'test-owner', 'conversation-123');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.durationMs).toBe(0);
  });

  it('passes owner and conversationId to trace record', async () => {
    const { recorder, traces } = createMockRecorder();
    const error = new ConstellationError(
      'test error',
      'TEST_ERROR',
      'test',
      {}
    );

    traceError(error, recorder, 'my-owner', 'my-conversation-id');

    await new Promise(resolve => setTimeout(resolve, 10));

    expect(traces).toHaveLength(1);
    expect(traces[0]!.owner).toBe('my-owner');
    expect(traces[0]!.conversationId).toBe('my-conversation-id');
  });

  it('swallows recorder rejections without throwing', async () => {
    const rejectedRecorder: TraceRecorder = {
      record: async () => {
        throw new Error('recorder failure');
      },
    };
    const error = new ConstellationError(
      'test error',
      'TEST_ERROR',
      'test',
      {}
    );

    // Should not throw
    traceError(error, rejectedRecorder, 'test-owner', 'conversation-123');

    // Wait for async to process
    await new Promise(resolve => setTimeout(resolve, 10));

    // If we get here without throwing, the test passes
    expect(true).toBe(true);
  });
});
