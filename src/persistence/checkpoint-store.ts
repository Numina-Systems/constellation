// pattern: Imperative Shell

/** PostgreSQL implementation of the checkpoint persistence adapter. */
import type {PersistenceProvider, QueryFunction} from './types.ts';
import type {SessionCheckpoint} from '@/agent/checkpoint-types.ts';
import {deserializeCheckpoint} from '@/agent/checkpoint-serializer.ts';

 type CheckpointRow = {readonly checkpoint_data: unknown};

export type CheckpointStore = {
  save(checkpoint: SessionCheckpoint): Promise<void>;
  load(id: string): Promise<SessionCheckpoint | null>;
  loadLatest(owner: string): Promise<SessionCheckpoint | null>;
  prune(conversationId: string, retainCount: number): Promise<number>;
};

async function saveWithQuery(query: QueryFunction, checkpoint: SessionCheckpoint): Promise<void> {
  await query(
    `INSERT INTO session_checkpoints (id, conversation_id, owner, trigger, checkpoint_data, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [checkpoint.id, checkpoint.conversationId, checkpoint.owner, checkpoint.trigger,
      JSON.stringify(checkpoint), checkpoint.createdAt],
  );
}

async function pruneWithQuery(query: QueryFunction, conversationId: string, retainCount: number): Promise<number> {
  const rows = await query<{readonly id: string}>(
    `DELETE FROM session_checkpoints
      WHERE conversation_id = $1
        AND id NOT IN (
          SELECT id FROM session_checkpoints
           WHERE conversation_id = $2
           ORDER BY created_at DESC, id DESC
           LIMIT $3
        )
      RETURNING id`, [conversationId, conversationId, retainCount],
  );
  return rows.length;
}

export function createCheckpointStore(persistence: PersistenceProvider): CheckpointStore {
  async function save(checkpoint: SessionCheckpoint): Promise<void> {
    try {
      await saveWithQuery(persistence.query, checkpoint);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`failed to save checkpoint ${checkpoint.id} for conversation ${checkpoint.conversationId}: ${message}`);
    }
  }

  async function load(id: string): Promise<SessionCheckpoint | null> {
    const rows = await persistence.query<CheckpointRow>('SELECT checkpoint_data FROM session_checkpoints WHERE id = $1', [id]);
    return rows.length === 0 ? null : deserializeCheckpoint(rows[0]?.checkpoint_data);
  }

  async function loadLatest(owner: string): Promise<SessionCheckpoint | null> {
    const rows = await persistence.query<CheckpointRow>(
      `SELECT checkpoint_data FROM session_checkpoints WHERE owner = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [owner],
    );
    return rows.length === 0 ? null : deserializeCheckpoint(rows[0]?.checkpoint_data);
  }

  async function prune(conversationId: string, retainCount: number): Promise<number> {
    if (!Number.isInteger(retainCount) || retainCount < 1) throw new Error('checkpoint retention must be a positive integer');
    return pruneWithQuery(persistence.query, conversationId, retainCount);
  }

  return {save, load, loadLatest, prune};
}

/** Save and count-prune a checkpoint without touching retained transcript rows. */
export async function saveAndPruneCheckpoint(
  persistence: PersistenceProvider,
  checkpoint: SessionCheckpoint,
  retainCount: number,
): Promise<number> {
  if (!Number.isInteger(retainCount) || retainCount < 1) throw new Error('checkpoint retention must be a positive integer');
  return persistence.withTransaction(async (query) => {
    await saveWithQuery(query, checkpoint);
    return pruneWithQuery(query, checkpoint.conversationId, retainCount);
  });
}
