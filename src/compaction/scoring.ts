// pattern: Functional Core

import type { ConversationMessage } from '../agent/types.js';
import type { ImportanceScoringConfig } from './types.js';
import { DEFAULT_SCORING_CONFIG } from './types.js';

/**
 * Scores a message based on its importance for compression.
 *
 * Scoring factors:
 * - Role weight: system > user > assistant (AC3.1)
 * - Recency decay: newer messages score higher (AC3.2)
 * - Content signals: questions, tool calls, keywords boost score (AC3.3)
 * - Content length: longer messages score slightly higher (capped at 3.0)
 *
 * @param msg The message to score
 * @param index The position of this message in the batch (0-based)
 * @param total The total number of messages in the batch
 * @param config Scoring configuration (defaults to DEFAULT_SCORING_CONFIG)
 * @returns A numeric importance score
 */
export function scoreMessage(
  msg: ConversationMessage,
  index: number,
  total: number,
  config: ImportanceScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  let score = 0;

  // Role weight (AC3.1)
  switch (msg.role) {
    case 'system':
      score += config.roleWeightSystem;
      break;
    case 'user':
      score += config.roleWeightUser;
      break;
    case 'assistant':
      score += config.roleWeightAssistant;
      break;
    case 'tool':
      score += config.roleWeightUser;
      break;
  }

  // Recency decay (AC3.2) — newer messages (higher index) score higher
  // Uses exponential decay: score *= decay^(total - 1 - index)
  // At index=total-1 (newest): multiplier = 1.0
  // At index=0 (oldest): multiplier = decay^(total-1)
  const distanceFromEnd = total - 1 - index;
  const recencyMultiplier = Math.pow(config.recencyDecay, distanceFromEnd);
  score *= recencyMultiplier;

  // Content signals (AC3.3)
  const content = msg.content;

  // Question marks
  if (content.includes('?')) {
    score += config.questionBonus;
  }

  // Tool calls — check if message has tool_calls field
  if (msg.tool_calls) {
    score += config.toolCallBonus;
  }

  // Important keywords — cumulative: +keywordBonus per distinct keyword match
  const lowerContent = content.toLowerCase();
  for (const keyword of config.importantKeywords) {
    if (lowerContent.includes(keyword.toLowerCase())) {
      score += config.keywordBonus;
    }
  }

  // Content length bonus: +contentLengthWeight per 100 chars, capped at 3.0
  const lengthBonus = Math.min(
    (content.length / 100) * config.contentLengthWeight,
    3.0,
  );
  score += lengthBonus;

  return score;
}
