// pattern: Functional Core

/**
 * Tests for the scoreMessage function.
 * Verifies importance scoring factors: role weight, recency decay, and content signals.
 */

import { describe, it, expect } from 'bun:test';
import type { ConversationMessage } from '../agent/types.js';
import { scoreMessage } from './scoring.js';
import { DEFAULT_SCORING_CONFIG } from './types.js';
import type { ImportanceScoringConfig } from './types.js';

/**
 * Test fixtures and helpers
 */

function createMessage(
  id: string,
  role: ConversationMessage['role'],
  content: string,
  offset: number = 0,
): ConversationMessage {
  return {
    id,
    conversation_id: 'test-conv',
    role,
    content,
    created_at: new Date(1000 + offset),
  };
}

/**
 * AC3.1: Role weight — system > user > assistant
 */
describe('scoreMessage role weight (AC3.1)', () => {
  it('should score system messages higher than user messages', () => {
    const systemMsg = createMessage('sys', 'system', 'System prompt');
    const userMsg = createMessage('user', 'user', 'System prompt');

    const sysScore = scoreMessage(systemMsg, 0, 1, DEFAULT_SCORING_CONFIG);
    const userScore = scoreMessage(userMsg, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(sysScore).toBeGreaterThan(userScore);
  });

  it('should score user messages higher than assistant messages', () => {
    const userMsg = createMessage('user', 'user', 'User message');
    const assistantMsg = createMessage('asst', 'assistant', 'User message');

    const userScore = scoreMessage(userMsg, 0, 1, DEFAULT_SCORING_CONFIG);
    const assistScore = scoreMessage(assistantMsg, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(userScore).toBeGreaterThan(assistScore);
  });

  it('should score tool messages same as user messages', () => {
    const userMsg = createMessage('user', 'user', 'Same content');
    const toolMsg = createMessage('tool', 'tool', 'Same content');

    const userScore = scoreMessage(userMsg, 0, 1, DEFAULT_SCORING_CONFIG);
    const toolScore = scoreMessage(toolMsg, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(userScore).toEqual(toolScore);
  });
});

/**
 * AC3.2: Recency decay — newer messages score higher
 */
describe('scoreMessage recency decay (AC3.2)', () => {
  it('should score newer messages higher than older messages', () => {
    const oldMsg = createMessage('old', 'user', 'Content');
    const newMsg = createMessage('new', 'user', 'Content');

    // Score at different positions: index 0 (oldest) vs index 9 (newest) in a batch of 10
    const oldScore = scoreMessage(oldMsg, 0, 10, DEFAULT_SCORING_CONFIG);
    const newScore = scoreMessage(newMsg, 9, 10, DEFAULT_SCORING_CONFIG);

    expect(newScore).toBeGreaterThan(oldScore);
  });

  it('should apply exponential decay correctly', () => {
    const msg = createMessage('msg', 'assistant', 'Same');
    const config = DEFAULT_SCORING_CONFIG;

    // In a batch of 3 messages:
    // index 0 (oldest): multiplier = 0.95^2 = 0.9025
    // index 1 (middle): multiplier = 0.95^1 = 0.95
    // index 2 (newest): multiplier = 0.95^0 = 1.0
    const score0 = scoreMessage(msg, 0, 3, config);
    const score1 = scoreMessage(msg, 1, 3, config);
    const score2 = scoreMessage(msg, 2, 3, config);

    expect(score0).toBeLessThan(score1);
    expect(score1).toBeLessThan(score2);
  });

  it('should have no recency penalty for single message', () => {
    const msg = createMessage('msg', 'assistant', 'Content');
    const config = DEFAULT_SCORING_CONFIG;

    // With total=1, distanceFromEnd = 0, so multiplier = decay^0 = 1.0
    const score = scoreMessage(msg, 0, 1, config);
    const baseScore = config.roleWeightAssistant + (msg.content.length / 100) * config.contentLengthWeight;

    expect(score).toBeCloseTo(baseScore, 5);
  });
});

/**
 * AC3.3: Content signals — questions, tool calls, keywords, length
 */
describe('scoreMessage content signals (AC3.3)', () => {
  it('should bonus messages with question marks', () => {
    const withQuestion = createMessage('q', 'user', 'What is this?');
    const noQuestion = createMessage('nq', 'user', 'This is a statement.');

    const qScore = scoreMessage(withQuestion, 0, 1, DEFAULT_SCORING_CONFIG);
    const noScore = scoreMessage(noQuestion, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(qScore).toBeGreaterThan(noScore);
  });

  it('should bonus messages with tool_calls', () => {
    const withToolCall = createMessage('tool', 'assistant', 'Calling tool');
    withToolCall.tool_calls = [{ id: 'call-1', name: 'my_tool', arguments: '{}' }];

    const noToolCall = createMessage('notool', 'assistant', 'Calling tool');

    const toolScore = scoreMessage(withToolCall, 0, 1, DEFAULT_SCORING_CONFIG);
    const noScore = scoreMessage(noToolCall, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(toolScore).toBeGreaterThan(noScore);
  });

  it('should bonus messages containing important keywords', () => {
    const withKeyword = createMessage('kw', 'user', 'There is a critical bug to fix');
    const noKeyword = createMessage('nkw', 'user', 'This is a test message');

    const kwScore = scoreMessage(withKeyword, 0, 1, DEFAULT_SCORING_CONFIG);
    const noScore = scoreMessage(noKeyword, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(kwScore).toBeGreaterThan(noScore);
  });

  it('should accumulate keyword bonuses for multiple keywords', () => {
    const singleKeyword = createMessage('one', 'user', 'This is a bug');
    const multipleKeywords = createMessage('multi', 'user', 'This bug is a critical error to fix');

    const oneScore = scoreMessage(singleKeyword, 0, 1, DEFAULT_SCORING_CONFIG);
    const multiScore = scoreMessage(multipleKeywords, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(multiScore).toBeGreaterThan(oneScore);
  });

  it('should bonus longer messages but cap at 3.0', () => {
    const short = createMessage('short', 'user', 'Hi');
    const long = createMessage('long', 'user', 'A'.repeat(500)); // 500 chars = (500/100)*1.0 = 5.0, capped at 3.0

    const shortScore = scoreMessage(short, 0, 1, DEFAULT_SCORING_CONFIG);
    const longScore = scoreMessage(long, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(longScore).toBeGreaterThan(shortScore);
  });

  it('should cap content length bonus at 3.0', () => {
    const content500 = createMessage('c500', 'user', 'A'.repeat(500));
    const content1000 = createMessage('c1000', 'user', 'A'.repeat(1000));

    const score500 = scoreMessage(content500, 0, 1, DEFAULT_SCORING_CONFIG);
    const score1000 = scoreMessage(content1000, 0, 1, DEFAULT_SCORING_CONFIG);

    // Both should cap at 3.0, so scores should be equal (within floating point)
    expect(score500).toBeCloseTo(score1000, 5);
  });
});

/**
 * Custom configuration
 */
describe('scoreMessage with custom config', () => {
  it('should use custom role weights', () => {
    const customConfig: ImportanceScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      roleWeightSystem: 20.0,
      roleWeightUser: 10.0,
      roleWeightAssistant: 1.0,
    };

    const systemMsg = createMessage('sys', 'system', 'Content');
    const userMsg = createMessage('user', 'user', 'Content');

    const sysScore = scoreMessage(systemMsg, 0, 1, customConfig);
    const userScore = scoreMessage(userMsg, 0, 1, customConfig);

    // With custom weights, the difference should be 20-10 = 10
    const scoreDiff = sysScore - userScore;
    expect(scoreDiff).toBeCloseTo(10.0, 5);
  });

  it('should use custom recency decay', () => {
    const slowDecay: ImportanceScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      recencyDecay: 0.5, // Stronger decay
    };

    const msg = createMessage('msg', 'assistant', 'Content');

    const oldScore = scoreMessage(msg, 0, 10, slowDecay);
    const newScore = scoreMessage(msg, 9, 10, slowDecay);

    // With stronger decay, the difference should be larger
    const defaultDiff = scoreMessage(msg, 9, 10, DEFAULT_SCORING_CONFIG) - scoreMessage(msg, 0, 10, DEFAULT_SCORING_CONFIG);
    const customDiff = newScore - oldScore;

    expect(customDiff).toBeGreaterThan(defaultDiff);
  });

  it('should use custom bonuses', () => {
    const customConfig: ImportanceScoringConfig = {
      ...DEFAULT_SCORING_CONFIG,
      questionBonus: 10.0,
    };

    const withQuestion = createMessage('q', 'user', 'Is this correct?');
    const noQuestion = createMessage('nq', 'user', 'This is correct.');

    const qScore = scoreMessage(withQuestion, 0, 1, customConfig);
    const noScore = scoreMessage(noQuestion, 0, 1, customConfig);

    // The difference should be approximately the questionBonus
    expect(qScore - noScore).toBeCloseTo(10.0, 1);
  });
});

/**
 * Edge cases
 */
describe('scoreMessage edge cases', () => {
  it('should handle empty content', () => {
    const empty = createMessage('empty', 'user', '');

    // Should not throw
    const score = scoreMessage(empty, 0, 1, DEFAULT_SCORING_CONFIG);
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it('should handle all identical messages', () => {
    const msg1 = createMessage('m1', 'user', 'Same');
    const msg2 = createMessage('m2', 'user', 'Same');
    const msg3 = createMessage('m3', 'user', 'Same');

    const score1 = scoreMessage(msg1, 0, 3, DEFAULT_SCORING_CONFIG);
    const score2 = scoreMessage(msg2, 1, 3, DEFAULT_SCORING_CONFIG);
    const score3 = scoreMessage(msg3, 2, 3, DEFAULT_SCORING_CONFIG);

    // Scores should differ only by recency decay
    expect(score1).toBeLessThan(score2);
    expect(score2).toBeLessThan(score3);
  });

  it('should handle special characters and unicode', () => {
    const special = createMessage('special', 'user', '!@#$%^&*() 你好 🎉');

    // Should not throw
    const score = scoreMessage(special, 0, 1, DEFAULT_SCORING_CONFIG);
    expect(typeof score).toBe('number');
  });

  it('should handle very large batches', () => {
    const msg = createMessage('msg', 'assistant', 'Content');

    // Score oldest and newest in a large batch
    const oldScore = scoreMessage(msg, 0, 1000, DEFAULT_SCORING_CONFIG);
    const newScore = scoreMessage(msg, 999, 1000, DEFAULT_SCORING_CONFIG);

    expect(newScore).toBeGreaterThan(oldScore);
  });

  it('should ignore case when checking keywords', () => {
    const upper = createMessage('upper', 'user', 'This is a BUG');
    const lower = createMessage('lower', 'user', 'This is a bug');

    const upperScore = scoreMessage(upper, 0, 1, DEFAULT_SCORING_CONFIG);
    const lowerScore = scoreMessage(lower, 0, 1, DEFAULT_SCORING_CONFIG);

    expect(upperScore).toEqual(lowerScore);
  });
});
