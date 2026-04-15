import { describe, it, expect } from 'bun:test';
import { createContinuationJudge } from './continuation-judge';
import type { ContinuationJudgeContext } from './continuation';
import type { ModelProvider, ModelRequest } from '@/model/types';
import type { Interest } from './types';
import type { OperationTrace } from '@/reflexion/types';

describe('impulse-continuation.AC2.1: ContinuationJudge calls ModelProvider and returns parsed decision', () => {
  it('calls model.complete with correct request format and returns parsed decision', async () => {
    const capturedRequests: Array<ModelRequest> = [];

    const mockModel: ModelProvider = {
      async complete(request: ModelRequest) {
        capturedRequests.push(request);
        return {
          content: [
            {
              type: 'text',
              text: '{"continue": true, "reason": "found momentum"}',
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const judge = createContinuationJudge({
      model: mockModel,
      modelName: 'test-model',
    });

    const trace: OperationTrace = {
      id: 'trace-1',
      owner: 'test',
      conversationId: 'conv-1',
      toolName: 'web_search',
      input: { query: 'test query' },
      outputSummary: 'Found test results',
      durationMs: 200,
      success: true,
      error: null,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    };

    const interest: Interest = {
      id: 'int-1',
      owner: 'test',
      name: 'Test Interest',
      description: 'A test interest',
      source: 'emergent',
      engagementScore: 7.5,
      status: 'active',
      lastEngagedAt: new Date('2026-04-15T11:00:00Z'),
      createdAt: new Date('2026-04-10T10:00:00Z'),
    };

    const context: ContinuationJudgeContext = {
      agentResponse: 'I discovered important information about test topic.',
      traces: [trace],
      interests: [interest],
      eventType: 'impulse',
    };

    const decision = await judge.evaluate(context);

    // Verify decision is parsed correctly
    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe('found momentum');

    // Verify request was captured and has correct format
    expect(capturedRequests.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const request = capturedRequests[0]!;

    // Check message structure
    expect(request.messages.length).toBe(1);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(request.messages[0]!.role).toBe('user');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(typeof request.messages[0]!.content).toBe('string');

    // Check agent response text is in prompt
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const promptContent = request.messages[0]!.content as string;
    expect(promptContent).toContain('I discovered important information about test topic.');

    // Check model parameters
    expect(request.model).toBe('test-model');
    expect(request.max_tokens).toBe(256);
    expect(request.temperature).toBe(0);
  });
});

describe('impulse-continuation.AC2.2: ContinuationJudge handles model provider errors gracefully', () => {
  it('returns shouldContinue false when model.complete throws', async () => {
    const mockModel: ModelProvider = {
      async complete() {
        throw new Error('Connection refused');
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const judge = createContinuationJudge({
      model: mockModel,
      modelName: 'test-model',
    });

    const context: ContinuationJudgeContext = {
      agentResponse: 'Test response',
      traces: [],
      interests: [],
      eventType: 'impulse',
    };

    const decision = await judge.evaluate(context);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toContain('Judge evaluation failed');
    expect(decision.reason).toContain('Connection refused');
  });
});

describe('impulse-continuation.AC2.3: ContinuationJudge handles unparseable responses', () => {
  it('returns shouldContinue false when response is valid text but not JSON', async () => {
    const mockModel: ModelProvider = {
      async complete() {
        return {
          content: [
            {
              type: 'text',
              text: 'I think we should continue exploring this topic further without any structure',
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const judge = createContinuationJudge({
      model: mockModel,
      modelName: 'test-model',
    });

    const context: ContinuationJudgeContext = {
      agentResponse: 'Test response',
      traces: [],
      interests: [],
      eventType: 'impulse',
    };

    const decision = await judge.evaluate(context);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });
});
