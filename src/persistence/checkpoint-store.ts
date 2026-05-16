// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the CheckpointStore adapter.
 * Manages session checkpoint persistence: save, load, prune.
 */

import type {PersistenceProvider} from './types.ts';
import type {SessionCheckpoint} from '@/agent/checkpoint-types.ts';
import {deserializeCheckpoint} from '@/agent/checkpoint-serializer.ts';

type CheckpointRow = {
  checkpoint_data: unknown;
};

export type CheckpointStore = {
  save(checkpoint: SessionCheckpoint): Promise<void>;
  load(id: string): Promise<SessionCheckpoint | null>;
  loadLatest(owner: string): Promise<SessionCheckpoint | null>;
  prune(conversationId: string, retainCount: number): Promise<number>;
};

export function createCheckpointStore(persistence: PersistenceProvider): CheckpointStore {
  async function save(checkpoint: SessionCheckpoint): Promise<void> {
    try {
      await persistence.query(
        `INSERT INTO session_checkpoints (id, conversation_id, owner, trigger, checkpoint_data, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          checkpoint.id,
          checkpoint.conversationId,
          checkpoint.owner,
          checkpoint.trigger,
          JSON.stringify(checkpoint),
          checkpoint.createdAt,
        ],
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `failed to save checkpoint ${checkpoint.id} for conversation ${checkpoint.conversationId}: ${message}`,
      );
    }
  }

  async function load(id: string): Promise<SessionCheckpoint | null> {
    const rows = await persistence.query<CheckpointRow>(
      'SELECT checkpoint_data FROM session_checkpoints WHERE id = $1',
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return deserializeCheckpoint(rows[0]!.checkpoint_data);
  }

  async function loadLatest(owner: string): Promise<SessionCheckpoint | null> {
    const rows = await persistence.query<CheckpointRow>(
      `SELECT checkpoint_data FROM session_checkpoints
       WHERE owner = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [owner],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return deserializeCheckpoint(rows[0]!.checkpoint_data);
  }

  async function prune(conversationId: string, retainCount: number): Promise<number> {
    // conversationId is passed to both outer WHERE and inner subquery WHERE
    // because PostgreSQL subqueries cannot reference outer scope parameters.
    // $1 filters the outer DELETE rows; $2 filters the subquery to identify
    // which checkpoints to keep (most recent N by created_at).
    const rows = await persistence.query<{id: string}>(
      `DELETE FROM session_checkpoints
       WHERE conversation_id = $1
         AND id NOT IN (
           SELECT id FROM session_checkpoints
           WHERE conversation_id = $2
           ORDER BY created_at DESC
           LIMIT $3
         )
       RETURNING id`,
      [conversationId, conversationId, retainCount],
    );

    return rows.length;
  }

  return {
    save,
    load,
    loadLatest,
    prune,
  };
}
