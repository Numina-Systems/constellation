// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the MemoryStore port.
 * Uses pgvector for semantic search and event sourcing for audit trail.
 */

import { randomUUID } from 'node:crypto';
import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { MemoryStore } from './store.ts';
import type {
  MemoryBlock,
  MemoryEvent,
  MemoryTier,
  PendingMutation,
  MemorySearchResult,
} from './types.ts';

type MemoryBlockRow = {
  id: string;
  owner: string;
  tier: MemoryTier;
  label: string;
  content: string;
  embedding: Array<number> | null;
  permission: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
};

type MemoryEventRow = {
  id: string;
  block_id: string;
  event_type: string;
  old_content: string | null;
  new_content: string | null;
  created_at: string;
};

type PendingMutationRow = {
  id: string;
  block_id: string;
  proposed_content: string;
  reason: string | null;
  status: string;
  feedback: string | null;
  created_at: string;
  resolved_at: string | null;
};

type SearchResult = {
  id: string;
  owner: string;
  tier: MemoryTier;
  label: string;
  content: string;
  embedding: Array<number> | null;
  permission: string;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  similarity: number;
};

function parseMemoryBlock(row: MemoryBlockRow): MemoryBlock {
  let embedding: Array<number> | null = null;
  if (row.embedding) {
    if (typeof row.embedding === 'string') {
      embedding = JSON.parse(row.embedding);
    } else {
      embedding = row.embedding;
    }
  }

  return {
    id: row.id,
    owner: row.owner,
    tier: row.tier,
    label: row.label,
    content: row.content,
    embedding,
    permission: row.permission as 'readonly' | 'familiar' | 'append' | 'readwrite',
    pinned: row.pinned,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
  };
}

function parseMemoryEvent(row: MemoryEventRow): MemoryEvent {
  return {
    id: row.id,
    block_id: row.block_id,
    event_type: row.event_type as 'create' | 'update' | 'delete' | 'archive',
    old_content: row.old_content,
    new_content: row.new_content,
    created_at: new Date(row.created_at),
  };
}

function parsePendingMutation(row: PendingMutationRow): PendingMutation {
  return {
    id: row.id,
    block_id: row.block_id,
    proposed_content: row.proposed_content,
    reason: row.reason,
    status: row.status as 'pending' | 'approved' | 'rejected',
    feedback: row.feedback,
    created_at: new Date(row.created_at),
    resolved_at: row.resolved_at ? new Date(row.resolved_at) : null,
  };
}

export function createPostgresMemoryStore(
  persistence: PersistenceProvider,
): MemoryStore {
  async function getBlock(id: string): Promise<MemoryBlock | null> {
    const rows = await persistence.query<MemoryBlockRow>(
      'SELECT * FROM memory_blocks WHERE id = $1',
      [id],
    );
    return rows.length > 0 ? parseMemoryBlock(rows[0]!) : null;
  }

  async function getBlocksByTier(
    owner: string,
    tier: MemoryTier,
  ): Promise<Array<MemoryBlock>> {
    const rows = await persistence.query<MemoryBlockRow>(
      'SELECT * FROM memory_blocks WHERE owner = $1 AND tier = $2 ORDER BY created_at ASC',
      [owner, tier],
    );
    return rows.map(parseMemoryBlock);
  }

  async function getBlockByLabel(
    owner: string,
    label: string,
  ): Promise<MemoryBlock | null> {
    const rows = await persistence.query<MemoryBlockRow>(
      'SELECT * FROM memory_blocks WHERE owner = $1 AND label = $2 LIMIT 1',
      [owner, label],
    );
    return rows.length > 0 ? parseMemoryBlock(rows[0]!) : null;
  }

  async function createBlock(
    block: Omit<MemoryBlock, 'created_at' | 'updated_at'>,
  ): Promise<MemoryBlock> {
    const id = block.id || randomUUID();
    const embeddingSql = block.embedding ? `'${toSql(block.embedding)}'::vector` : 'NULL';

    const rows = await persistence.query<MemoryBlockRow>(
      `INSERT INTO memory_blocks
       (id, owner, tier, label, content, embedding, permission, pinned)
       VALUES ($1, $2, $3, $4, $5, ${embeddingSql}, $6, $7)
       RETURNING *`,
      [id, block.owner, block.tier, block.label, block.content, block.permission, block.pinned],
    );

    // INSERT RETURNING always produces a row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseMemoryBlock(rows[0]!);
  }

  async function updateBlock(
    id: string,
    content: string,
    embedding: ReadonlyArray<number> | null,
  ): Promise<MemoryBlock> {
    const embeddingSql = embedding ? `'${toSql(embedding)}'::vector` : 'NULL';

    const rows = await persistence.query<MemoryBlockRow>(
      `UPDATE memory_blocks
       SET content = $1, embedding = ${embeddingSql}, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [content, id],
    );

    if (rows.length === 0) {
      throw new Error(`block not found: ${id}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseMemoryBlock(rows[0]!);
  }

  async function deleteBlock(id: string): Promise<void> {
    await persistence.query('DELETE FROM memory_blocks WHERE id = $1', [id]);
  }

  async function searchByEmbedding(
    owner: string,
    embedding: ReadonlyArray<number>,
    limit: number,
    tier?: MemoryTier,
  ): Promise<Array<MemorySearchResult>> {
    const embeddingSql = `'${toSql(embedding)}'::vector`;
    const tierFilter = tier ? 'AND tier = $3' : '';
    const params = tier ? [owner, limit, tier] : [owner, limit];

    const rows = await persistence.query<SearchResult>(
      `SELECT *, (1 - (embedding <=> ${embeddingSql})) as similarity
       FROM memory_blocks
       WHERE owner = $1 AND embedding IS NOT NULL ${tierFilter}
       ORDER BY similarity DESC
       LIMIT $2`,
      params,
    );

    return rows.map((row) => ({
      block: parseMemoryBlock(row),
      similarity: row.similarity,
    }));
  }

  async function logEvent(
    event: Omit<MemoryEvent, 'id' | 'created_at'>,
  ): Promise<MemoryEvent> {
    const id = randomUUID();
    const rows = await persistence.query<MemoryEventRow>(
      `INSERT INTO memory_events (id, block_id, event_type, old_content, new_content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, event.block_id, event.event_type, event.old_content, event.new_content],
    );

    // INSERT RETURNING always produces a row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseMemoryEvent(rows[0]!);
  }

  async function getEvents(blockId: string): Promise<Array<MemoryEvent>> {
    const rows = await persistence.query<MemoryEventRow>(
      'SELECT * FROM memory_events WHERE block_id = $1 ORDER BY created_at ASC',
      [blockId],
    );
    return rows.map(parseMemoryEvent);
  }

  async function createMutation(
    mutation: Omit<PendingMutation, 'id' | 'created_at' | 'resolved_at'>,
  ): Promise<PendingMutation> {
    const id = randomUUID();
    const rows = await persistence.query<PendingMutationRow>(
      `INSERT INTO pending_mutations (id, block_id, proposed_content, reason, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [id, mutation.block_id, mutation.proposed_content, mutation.reason, 'pending'],
    );

    // INSERT RETURNING always produces a row or throws
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parsePendingMutation(rows[0]!);
  }

  async function getPendingMutations(owner?: string): Promise<Array<PendingMutation>> {
    let query =
      `SELECT pm.* FROM pending_mutations pm
       JOIN memory_blocks mb ON pm.block_id = mb.id
       WHERE pm.status = 'pending'`;
    const params: Array<string> = [];

    if (owner) {
      query += ' AND mb.owner = $1';
      params.push(owner);
    }

    query += ' ORDER BY pm.created_at ASC';

    const rows = await persistence.query<PendingMutationRow>(query, params);
    return rows.map(parsePendingMutation);
  }

  async function resolveMutation(
    id: string,
    status: 'approved' | 'rejected',
    feedback?: string,
  ): Promise<PendingMutation> {
    const rows = await persistence.query<PendingMutationRow>(
      `UPDATE pending_mutations
       SET status = $1, feedback = $2, resolved_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, feedback || null, id],
    );

    if (rows.length === 0) {
      throw new Error(`mutation not found: ${id}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parsePendingMutation(rows[0]!);
  }

  return {
    getBlock,
    getBlocksByTier,
    getBlockByLabel,
    createBlock,
    updateBlock,
    deleteBlock,
    searchByEmbedding,
    logEvent,
    getEvents,
    createMutation,
    getPendingMutations,
    resolveMutation,
  };
}
