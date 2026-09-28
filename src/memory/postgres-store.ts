// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the MemoryStore port.
 * Uses pgvector for semantic search and event sourcing for audit trail.
 */

import { randomUUID } from 'node:crypto';
import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../persistence/types.ts';
import { MemoryError } from '@/errors/index.js';
import type {MemoryStoreWithMaintenance} from './store.ts';
import {evaluateMaintenanceMemoryMutation, evaluatePublicMemoryDeletion, type MaintenanceMemoryConstraints} from './deletion-policy.ts';
import type {
  MemoryBlock,
  MemoryEvent,
  MemorySearchResult,
  MemoryTier,
  PendingMutation,
  WorkingMemoryReplacementBlock,
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
  block_id: string | null;
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
): MemoryStoreWithMaintenance {
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

  async function getBlocksByLabelPrefix(
    owner: string,
    prefix: string,
    tier?: MemoryTier,
  ): Promise<ReadonlyArray<MemoryBlock>> {
    const escapedPrefix = prefix.replace(/[%_]/g, '\\$&');

    if (tier) {
      const rows = await persistence.query<MemoryBlockRow>(
        `SELECT * FROM memory_blocks WHERE owner = $1 AND label LIKE $2 AND tier = $3 ORDER BY label ASC`,
        [owner, `${escapedPrefix}%`, tier],
      );
      return rows.map(parseMemoryBlock);
    }

    const rows = await persistence.query<MemoryBlockRow>(
      `SELECT * FROM memory_blocks WHERE owner = $1 AND label LIKE $2 ORDER BY label ASC`,
      [owner, `${escapedPrefix}%`],
    );
    return rows.map(parseMemoryBlock);
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
      throw new MemoryError(
        'BLOCK_NOT_FOUND',
        `Block not found: ${id}`,
        { blockId: id },
        { suggestion: 'Verify the block ID exists before updating' },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseMemoryBlock(rows[0]!);
  }

  async function updateBlockTier(
    id: string,
    tier: MemoryTier,
  ): Promise<MemoryBlock> {
    const rows = await persistence.query<MemoryBlockRow>(
      `UPDATE memory_blocks
       SET tier = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [tier, id],
    );

    if (rows.length === 0) {
      throw new MemoryError(
        'BLOCK_NOT_FOUND',
        `Block not found: ${id}`,
        { blockId: id, targetTier: tier },
        { suggestion: 'Verify the block ID exists before changing tier' },
      );
    }

    return parseMemoryBlock(rows[0]!);
  }

  async function deleteBlock(id: string, owner: string): Promise<void> {
    if (!owner.trim()) {
      throw new MemoryError(
        'PERMISSION_DENIED',
        'memory deletion requires an owner-scoped authorization context',
      );
    }

    await persistence.withTransaction(async (query) => {
      const rows = await query<MemoryBlockRow>(
        'SELECT * FROM memory_blocks WHERE id = $1 FOR UPDATE',
        [id],
      );
      const block = rows.length > 0 ? parseMemoryBlock(rows[0]!) : null;
      const decision = evaluatePublicMemoryDeletion(owner, block);
      if (!decision.allowed) {
        throw new MemoryError(
          decision.reason === 'missing_or_foreign' ? 'BLOCK_NOT_FOUND' : 'PERMISSION_DENIED',
          decision.message,
        );
      }

      await insertDeleteEvent(query, block!);
      const deleted = await query<MemoryBlockRow>(
        'DELETE FROM memory_blocks WHERE id = $1 AND owner = $2 RETURNING id',
        [id, owner],
      );
      if (deleted.length === 0) {
        throw new MemoryError('BLOCK_NOT_FOUND', 'memory block not found');
      }
    });
  }

  async function insertDeleteEvent(
    query: typeof persistence.query,
    block: Readonly<MemoryBlock>,
  ): Promise<void> {
    await query<MemoryEventRow>(
      `INSERT INTO memory_events (id, block_id, event_type, old_content, new_content)
       VALUES ($1, $2, 'delete', NULL, NULL)`,
      [randomUUID(), block.id],
    );
  }

  async function deleteForMaintenance(
    owner: string,
    id: string,
    constraints: Readonly<MaintenanceMemoryConstraints>,
  ): Promise<void> {
    if (!owner.trim()) throw new MemoryError('PERMISSION_DENIED', 'maintenance deletion requires an owner');
    await persistence.withTransaction(async (query) => {
      const rows = await query<MemoryBlockRow>(
        'SELECT * FROM memory_blocks WHERE id = $1 FOR UPDATE',
        [id],
      );
      const block = rows.length > 0 ? parseMemoryBlock(rows[0]!) : null;
      const decision = evaluateMaintenanceMemoryMutation(owner, block, constraints);
      if (!decision.allowed) {
        throw new MemoryError(
          decision.reason === 'missing_or_foreign' ? 'BLOCK_NOT_FOUND' : 'PERMISSION_DENIED',
          decision.message,
        );
      }
      await insertDeleteEvent(query, block!);
      const deleted = await query<MemoryBlockRow>(
        'DELETE FROM memory_blocks WHERE id = $1 AND owner = $2 RETURNING id',
        [id, owner],
      );
      if (deleted.length === 0) throw new MemoryError('BLOCK_NOT_FOUND', 'memory block not found');
    });
  }

  async function replaceWorkingMemory(
    owner: string,
    blocks: ReadonlyArray<WorkingMemoryReplacementBlock>,
  ): Promise<Array<MemoryBlock>> {
    if (!owner.trim()) throw new MemoryError('PERMISSION_DENIED', 'working memory replacement requires an owner');
    return persistence.withTransaction(async (query) => {
      const existingRows = await query<MemoryBlockRow>(
        "SELECT * FROM memory_blocks WHERE owner = $1 AND tier = 'working' FOR UPDATE",
        [owner],
      );
      const existingBlocks = existingRows.map(parseMemoryBlock);
      for (const existing of existingBlocks) {
        const decision = evaluatePublicMemoryDeletion(owner, existing);
        if (!decision.allowed) {
          throw new MemoryError('PERMISSION_DENIED', 'working memory contains a protected block');
        }
      }
      for (const existing of existingBlocks) {
        await insertDeleteEvent(query, existing);
        await query<MemoryBlockRow>(
          'DELETE FROM memory_blocks WHERE id = $1 AND owner = $2',
          [existing.id, owner],
        );
      }
      const replacement: Array<MemoryBlock> = [];
      for (const block of blocks) {
        const created = await createBlockWithQuery(query, {
          id: randomUUID(), owner, tier: 'working', label: block.label,
          content: block.content, embedding: null, permission: 'readwrite', pinned: false,
        });
        await query<MemoryEventRow>(
          `INSERT INTO memory_events (id, block_id, event_type, old_content, new_content)
           VALUES ($1, $2, 'create', NULL, $3)`,
          [randomUUID(), created.id, created.content],
        );
        replacement.push(created);
      }
      return replacement;
    });
  }

  async function createBlockWithQuery(
    query: typeof persistence.query,
    block: Omit<MemoryBlock, 'created_at' | 'updated_at'>,
  ): Promise<MemoryBlock> {
    const rows = await query<MemoryBlockRow>(
      `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7) RETURNING *`,
      [block.id, block.owner, block.tier, block.label, block.content, block.permission, block.pinned],
    );
    return parseMemoryBlock(rows[0]!);
  }

  async function updateForMaintenance(
    owner: string,
    id: string,
    content: string,
    embedding: ReadonlyArray<number> | null,
    constraints: Readonly<MaintenanceMemoryConstraints>,
  ): Promise<MemoryBlock> {
    if (!owner.trim()) throw new MemoryError('PERMISSION_DENIED', 'maintenance update requires an owner');
    return persistence.withTransaction(async (query) => {
      const rows = await query<MemoryBlockRow>(
        'SELECT * FROM memory_blocks WHERE id = $1 FOR UPDATE',
        [id],
      );
      const block = rows.length > 0 ? parseMemoryBlock(rows[0]!) : null;
      const decision = evaluateMaintenanceMemoryMutation(owner, block, constraints);
      if (!decision.allowed) {
        throw new MemoryError(
          decision.reason === 'missing_or_foreign' ? 'BLOCK_NOT_FOUND' : 'PERMISSION_DENIED',
          decision.message,
        );
      }
      const embeddingSql = embedding ? `'${toSql(embedding)}'::vector` : 'NULL';
      const updatedRows = await query<MemoryBlockRow>(
        `UPDATE memory_blocks SET content = $1, embedding = ${embeddingSql}, updated_at = NOW()
         WHERE id = $2 AND owner = $3 RETURNING *`,
        [content, id, owner],
      );
      if (updatedRows.length === 0) throw new MemoryError('BLOCK_NOT_FOUND', 'memory block not found');
      await query<MemoryEventRow>(
        `INSERT INTO memory_events (id, block_id, event_type, old_content, new_content)
         VALUES ($1, $2, 'update', $3, $4)`,
        [randomUUID(), id, block!.content, content],
      );
      return parseMemoryBlock(updatedRows[0]!);
    });
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

  async function getPendingMutations(owner: string): Promise<Array<PendingMutation>> {
    if (!owner.trim()) throw new MemoryError('PERMISSION_DENIED', 'pending mutation lookup requires an owner');
    const query =
      `SELECT pm.* FROM pending_mutations pm
       JOIN memory_blocks mb ON pm.block_id = mb.id
       WHERE pm.status = 'pending' AND mb.owner = $1
       ORDER BY pm.created_at ASC`;
    const params: Array<string> = [owner];

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
      throw new MemoryError(
        'MUTATION_NOT_FOUND',
        `Mutation not found: ${id}`,
        { mutationId: id },
        { suggestion: 'Verify the mutation ID exists before resolving' },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parsePendingMutation(rows[0]!);
  }

  return {
    getBlock,
    getBlocksByTier,
    getBlockByLabel,
    getBlocksByLabelPrefix,
    createBlock,
    updateBlock,
    updateBlockTier,
    deleteBlock,
    replaceWorkingMemory,
    deleteForMaintenance,
    updateForMaintenance,
    searchByEmbedding,
    logEvent,
    getEvents,
    createMutation,
    getPendingMutations,
    resolveMutation,
  };
}
