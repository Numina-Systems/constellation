// pattern: Imperative Shell

import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type {
  ActivityManager,
  ActivityMode,
  ActivityState,
  ActivityStateRow,
  EventQueueRow,
  QueuedEvent,
  NewQueuedEvent,
} from './types.ts';
import { currentMode, nextTransitionTime, type ScheduleConfig } from './schedule.ts';

function parseActivityState(
  row: ActivityStateRow,
  queuedEventCount: number,
  flaggedEventCount: number,
): ActivityState {
  return {
    mode: row.mode as ActivityMode, // CHECK constraint guarantees valid values
    transitionedAt: row.transitioned_at,
    nextTransitionAt: row.next_transition_at,
    queuedEventCount,
    flaggedEventCount,
  };
}

function parseQueuedEvent(row: EventQueueRow): QueuedEvent {
  return {
    id: row.id,
    source: row.source,
    payload: row.payload,
    priority: row.priority as 'normal' | 'high', // CHECK constraint guarantees valid values
    enqueuedAt: row.enqueued_at,
    flagged: row.flagged,
  };
}

export function createActivityManager(
  persistence: PersistenceProvider,
  config: Readonly<ScheduleConfig>,
  owner: string,
): ActivityManager {
  const manager: ActivityManager = {
    async getState(): Promise<ActivityState> {
      const rows = await persistence.query<ActivityStateRow>(
        'SELECT * FROM activity_state WHERE owner = $1',
        [owner],
      );

      let stateRow: ActivityStateRow;

      if (rows.length === 0) {
        // Compute initial mode from cron expressions
        const initialMode = currentMode(config);
        const nextTransition = nextTransitionTime(initialMode, config);

        const newRows = await persistence.query<ActivityStateRow>(
          `INSERT INTO activity_state (owner, mode, transitioned_at, next_transition_at, updated_at)
           VALUES ($1, $2, NOW(), $3, NOW())
           RETURNING *`,
          [owner, initialMode, nextTransition],
        );

        if (newRows.length === 0) {
          throw new Error('Failed to insert activity state');
        }

        stateRow = newRows[0]!;
      } else {
        stateRow = rows[0]!;
      }

      // Count unprocessed events
      const queuedRows = await persistence.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM event_queue WHERE owner = $1 AND processed_at IS NULL',
        [owner],
      );

      const queuedEventCount = queuedRows.length > 0 ? parseInt(queuedRows[0]!.count, 10) : 0;

      // Count flagged unprocessed events
      const flaggedRows = await persistence.query<{ count: string }>(
        'SELECT COUNT(*) as count FROM event_queue WHERE owner = $1 AND flagged = TRUE AND processed_at IS NULL',
        [owner],
      );

      const flaggedEventCount = flaggedRows.length > 0 ? parseInt(flaggedRows[0]!.count, 10) : 0;

      return parseActivityState(stateRow, queuedEventCount, flaggedEventCount);
    },

    async isActive(): Promise<boolean> {
      const state = await manager.getState();
      return state.mode === 'active';
    },

    async transitionTo(mode: ActivityMode): Promise<void> {
      const nextTransition = nextTransitionTime(mode, config);

      await persistence.query(
        `INSERT INTO activity_state (owner, mode, transitioned_at, next_transition_at, updated_at)
         VALUES ($1, $2, NOW(), $3, NOW())
         ON CONFLICT (owner) DO UPDATE SET
           mode = $2,
           transitioned_at = NOW(),
           next_transition_at = $3,
           updated_at = NOW()`,
        [owner, mode, nextTransition],
      );
    },

    async queueEvent(event: NewQueuedEvent): Promise<void> {
      const id = randomUUID();

      await persistence.query(
        `INSERT INTO event_queue (id, owner, source, payload, priority, flagged, enqueued_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [id, owner, event.source, event.payload, event.priority, event.flagged],
      );
    },

    async flagEvent(eventId: string): Promise<void> {
      await persistence.query(
        'UPDATE event_queue SET flagged = TRUE WHERE id = $1 AND owner = $2',
        [eventId, owner],
      );
    },

    async *drainQueue(): AsyncGenerator<QueuedEvent> {
      // Single-process assumption: one daemon per owner. No concurrent drainQueue() calls.
      // If concurrency is ever needed, use UPDATE ... RETURNING with FOR UPDATE SKIP LOCKED.
      while (true) {
        const rows = await persistence.query<EventQueueRow>(
          `SELECT * FROM event_queue
           WHERE owner = $1 AND processed_at IS NULL
           ORDER BY CASE WHEN priority = 'high' THEN 0 ELSE 1 END, enqueued_at ASC
           LIMIT 1`,
          [owner],
        );

        if (rows.length === 0) {
          break;
        }

        const row = rows[0]!;

        await persistence.query(
          'UPDATE event_queue SET processed_at = NOW() WHERE id = $1',
          [row.id],
        );

        yield parseQueuedEvent(row);
      }
    },

    async getFlaggedEvents(): Promise<ReadonlyArray<QueuedEvent>> {
      const rows = await persistence.query<EventQueueRow>(
        `SELECT * FROM event_queue
         WHERE owner = $1 AND flagged = TRUE AND processed_at IS NULL`,
        [owner],
      );

      return rows.map(parseQueuedEvent);
    },
  };

  return manager;
}
