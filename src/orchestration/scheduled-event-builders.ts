// pattern: Imperative Shell

import type { TraceStore } from '@/reflexion';
import { formatTraceSummary } from '@/scheduled-context';

/**
 * Build a review event from a scheduled task with trace enrichment.
 * Queries recent operation traces and includes them in the event content.
 * Extracted for testability - allows tests to verify the exact event shape
 * that the scheduler's onDue handler produces.
 */
export async function buildReviewEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}> {
  const traces = await traceStore.queryTraces({
    owner,
    lookbackSince: new Date(Date.now() - 2 * 3600_000),
    limit: 20,
  });
  const activitySection = formatTraceSummary(traces);

  return {
    source: 'review-job',
    content: [
      `Scheduled task "${task.name}" has fired.`,
      '',
      'Review your pending predictions against recent operation traces.',
      'Use self_introspect to see your recent tool usage, then use list_predictions to see pending predictions.',
      'For each prediction, use annotate_prediction to record whether it was accurate.',
      'After reviewing, write a brief reflection to archival memory summarizing what you learned.',
      '',
      'If you have no pending predictions, still write a brief reflection noting this and consider whether you should be making predictions about outcomes of your actions.',
      '',
      activitySection,
    ].join('\n'),
    metadata: {
      taskId: task.id,
      taskName: task.name,
      schedule: task.schedule,
      ...task.payload,
    },
    timestamp: new Date(),
  };
}

/**
 * Build an agent-scheduled event from a scheduled task with trace enrichment.
 * Queries recent operation traces and includes them in the event content.
 * For tasks scheduled by the agent itself (not system review tasks).
 */
export async function buildAgentScheduledEvent(
  task: {
    id: string;
    name: string;
    schedule: string;
    payload?: Record<string, unknown>;
  },
  traceStore: TraceStore,
  owner: string,
): Promise<{
  source: string;
  content: string;
  metadata: Record<string, unknown>;
  timestamp: Date;
}> {
  const traces = await traceStore.queryTraces({
    owner,
    lookbackSince: new Date(Date.now() - 2 * 3600_000),
    limit: 20,
  });
  const activitySection = formatTraceSummary(traces);

  const prompt = String(task.payload?.['prompt'] ?? '') || 'Execute this scheduled task.';

  return {
    source: 'agent-scheduled',
    content: [
      `Scheduled task "${task.name}" has fired.`,
      '',
      prompt,
      '',
      activitySection,
    ].join('\n'),
    metadata: {
      taskId: task.id,
      taskName: task.name,
      schedule: task.schedule,
      ...task.payload,
    },
    timestamp: new Date(),
  };
}
