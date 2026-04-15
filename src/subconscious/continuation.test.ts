import { describe, it, expect } from 'bun:test';
import { buildContinuationPrompt, parseContinuationResponse } from './continuation';
import type { ContinuationJudgeContext } from './continuation';
import type { OperationTrace } from '@/reflexion/types';
import type { Interest } from './types';

describe('impulse-continuation.AC1.1: buildContinuationPrompt includes required content', () => {
  it('includes agent response text, trace summaries, interest names and scores, and event type', () => {
    const trace: OperationTrace = {
      id: 'trace-1',
      owner: 'test',
      conversationId: 'conv-1',
      toolName: 'web_search',
      input: { query: 'lattice cryptography' },
      outputSummary: 'Found 3 results about lattice-based cryptography',
      durationMs: 500,
      success: true,
      error: null,
      createdAt: new Date('2026-04-15T12:00:00Z'),
    };

    const interest1: Interest = {
      id: 'int-1',
      owner: 'test',
      name: 'Cryptography',
      description: 'Post-quantum cryptographic methods',
      source: 'emergent',
      engagementScore: 8.5,
      status: 'active',
      lastEngagedAt: new Date('2026-04-15T11:00:00Z'),
      createdAt: new Date('2026-04-10T10:00:00Z'),
    };

    const interest2: Interest = {
      id: 'int-2',
      owner: 'test',
      name: 'Quantum Computing',
      description: 'Quantum algorithms and applications',
      source: 'emergent',
      engagementScore: 7.2,
      status: 'active',
      lastEngagedAt: new Date('2026-04-15T10:30:00Z'),
      createdAt: new Date('2026-04-12T14:00:00Z'),
    };

    const context: ContinuationJudgeContext = {
      agentResponse: 'I found interesting patterns in the data about post-quantum cryptography.',
      traces: [trace],
      interests: [interest1, interest2],
      eventType: 'impulse',
    };

    const prompt = buildContinuationPrompt(context);

    // Check agent response text
    expect(prompt).toContain('I found interesting patterns in the data about post-quantum cryptography.');

    // Check trace summaries are included (formatTraceSummary output)
    expect(prompt).toContain('[Recent Activity]');
    expect(prompt).toContain('web_search');
    expect(prompt).toContain('Found 3 results');

    // Check interest names and scores
    expect(prompt).toContain('Cryptography');
    expect(prompt).toContain('8.50');
    expect(prompt).toContain('Quantum Computing');
    expect(prompt).toContain('7.20');

    // Check event type
    expect(prompt).toContain('impulse');
  });

  it('includes instructions to return JSON', () => {
    const context: ContinuationJudgeContext = {
      agentResponse: 'Test response',
      traces: [],
      interests: [],
      eventType: 'introspection',
    };

    const prompt = buildContinuationPrompt(context);

    expect(prompt).toContain('{"continue":');
    expect(prompt).toContain('"reason":');
  });
});

describe('impulse-continuation.AC1.2: parseContinuationResponse parses valid JSON', () => {
  it('parses valid JSON with continue true', () => {
    const response = '{"continue": true, "reason": "exploring further"}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe('exploring further');
  });

  it('parses valid JSON with continue false', () => {
    const response = '{"continue": false, "reason": "sufficient exploration"}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('sufficient exploration');
  });

  it('handles JSON embedded in markdown code blocks', () => {
    const response = '```json\n{"continue": true, "reason": "continue investigation"}\n```';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(true);
    expect(decision.reason).toBe('continue investigation');
  });

  it('handles JSON in code blocks without json language tag', () => {
    const response = '```\n{"continue": false, "reason": "done"}\n```';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('done');
  });
});

describe('impulse-continuation.AC1.3: parseContinuationResponse handles malformed input', () => {
  it('returns shouldContinue false for truncated JSON', () => {
    const response = '{"continue": tr';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });

  it('returns shouldContinue false for missing continue field', () => {
    const response = '{"reason": "test"}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });

  it('returns shouldContinue false for missing reason field', () => {
    const response = '{"continue": true}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });

  it('returns shouldContinue false for non-JSON text', () => {
    const response = 'I think we should continue';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });

  it('returns shouldContinue false for empty string', () => {
    const response = '';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
    expect(decision.reason).toBe('Failed to parse continuation response');
  });

  it('returns shouldContinue false when continue field is not boolean', () => {
    const response = '{"continue": "yes", "reason": "test"}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
  });

  it('returns shouldContinue false when reason field is not string', () => {
    const response = '{"continue": true, "reason": 123}';
    const decision = parseContinuationResponse(response);

    expect(decision.shouldContinue).toBe(false);
  });
});

describe('impulse-continuation.AC1.4: buildContinuationPrompt handles edge cases', () => {
  it('produces valid string with empty agentResponse', () => {
    const context: ContinuationJudgeContext = {
      agentResponse: '',
      traces: [],
      interests: [],
      eventType: 'impulse',
    };

    const prompt = buildContinuationPrompt(context);

    expect(prompt).toBeTruthy();
    expect(prompt.length).toBeGreaterThan(0);
    expect(prompt).toContain('(no response)');
  });

  it('handles empty traces array gracefully', () => {
    const context: ContinuationJudgeContext = {
      agentResponse: 'test',
      traces: [],
      interests: [],
      eventType: 'impulse',
    };

    const prompt = buildContinuationPrompt(context);

    expect(prompt).toContain('No recent activity recorded');
  });

  it('handles empty interests array gracefully', () => {
    const context: ContinuationJudgeContext = {
      agentResponse: 'test',
      traces: [],
      interests: [],
      eventType: 'impulse',
    };

    const prompt = buildContinuationPrompt(context);

    expect(prompt).toContain('No active interests');
  });

  it('handles introspection event type', () => {
    const context: ContinuationJudgeContext = {
      agentResponse: 'test',
      traces: [],
      interests: [],
      eventType: 'introspection',
    };

    const prompt = buildContinuationPrompt(context);

    expect(prompt).toContain('introspection');
  });
});
