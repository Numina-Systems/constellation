// pattern: Functional Core

import type { QueuedEvent } from './types.ts';

export type SleepTaskEvent = {
  readonly source: string;
  readonly content: string;
  readonly metadata: Record<string, unknown>;
  readonly timestamp: Date;
};

export function buildCompactionEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
  timestamp: Date,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Context Compaction',
    '',
    'You are in sleep mode. Perform context compaction:',
    '- Use compact_context to consolidate recent conversation history',
    '- Archive important working memory to archival memory',
    '- Clean up temporary notes and observations',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'compaction', sleepTask: true },
    timestamp,
  };
}

export function buildPredictionReviewEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
  timestamp: Date,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Prediction Review',
    '',
    'You are in sleep mode. Review your predictions:',
    '- Use list_predictions to see pending predictions',
    '- Use self_introspect to review recent operation traces',
    '- Annotate each prediction with your assessment',
    '- Write a brief reflection to archival memory',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'prediction-review', sleepTask: true },
    timestamp,
  };
}

export function buildPatternAnalysisEvent(
  flaggedEvents: ReadonlyArray<QueuedEvent>,
  timestamp: Date,
): SleepTaskEvent {
  const lines = [
    'Sleep task: Pattern Analysis',
    '',
    'You are in sleep mode. Analyze patterns from recent activity:',
    '- Use self_introspect to review your operation traces',
    '- Look for recurring patterns in your tool usage and responses',
    '- Identify areas where you could improve efficiency or accuracy',
    '- Write insights to archival memory for future reference',
  ];

  appendFlaggedSummary(lines, flaggedEvents);

  return {
    source: 'sleep-task',
    content: lines.join('\n'),
    metadata: { taskType: 'pattern-analysis', sleepTask: true },
    timestamp,
  };
}

function appendFlaggedSummary(
  lines: Array<string>,
  flaggedEvents: ReadonlyArray<QueuedEvent>,
): void {
  if (flaggedEvents.length === 0) return;

  lines.push('');
  lines.push(`[Flagged Events: ${flaggedEvents.length} high-priority items arrived during sleep]`);
  for (const event of flaggedEvents) {
    lines.push(`- [${event.source}] at ${event.enqueuedAt.toISOString()}`);
  }
  lines.push('Review these and decide if any require immediate action.');
}
