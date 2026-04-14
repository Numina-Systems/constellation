// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the InterestRegistry port.
 * Manages interests, curiosity threads, exploration logging, and engagement dynamics.
 */

import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type {
  Interest,
  CuriosityThread,
  ExplorationLogEntry,
  InterestRegistry,
} from './types.ts';

type InterestRow = {
  id: string;
  owner: string;
  name: string;
  description: string;
  source: string;
  engagement_score: number;
  status: string;
  last_engaged_at: string;
  created_at: string;
};

type CuriosityThreadRow = {
  id: string;
  interest_id: string;
  owner: string;
  question: string;
  status: string;
  resolution: string | null;
  created_at: string;
  updated_at: string;
};

type ExplorationLogRow = {
  id: string;
  owner: string;
  interest_id: string | null;
  curiosity_thread_id: string | null;
  action: string;
  tools_used: ReadonlyArray<string> | string;
  outcome: string;
  created_at: string;
};

function parseInterest(row: InterestRow): Interest {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    source: row.source as Interest['source'],
    engagementScore: row.engagement_score,
    status: row.status as Interest['status'],
    lastEngagedAt: new Date(row.last_engaged_at),
    createdAt: new Date(row.created_at),
  };
}

function parseCuriosityThread(row: CuriosityThreadRow): CuriosityThread {
  return {
    id: row.id,
    interestId: row.interest_id,
    owner: row.owner,
    question: row.question,
    status: row.status as CuriosityThread['status'],
    resolution: row.resolution,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

function parseExplorationLogEntry(row: ExplorationLogRow): ExplorationLogEntry {
  return {
    id: row.id,
    owner: row.owner,
    interestId: row.interest_id,
    curiosityThreadId: row.curiosity_thread_id,
    action: row.action,
    toolsUsed: Array.isArray(row.tools_used) ? row.tools_used : JSON.parse(row.tools_used as string),
    outcome: row.outcome,
    createdAt: new Date(row.created_at),
  };
}

export function createInterestRegistry(
  persistence: PersistenceProvider,
): InterestRegistry {
  async function createInterest(
    interest: Omit<Interest, 'id' | 'createdAt' | 'lastEngagedAt'>,
  ): Promise<Interest> {
    const id = randomUUID();
    const rows = await persistence.query<InterestRow>(
      `INSERT INTO interests
       (id, owner, name, description, source, engagement_score, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        interest.owner,
        interest.name,
        interest.description,
        interest.source,
        interest.engagementScore,
        interest.status,
      ],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseInterest(rows[0]!);
  }

  async function getInterest(id: string): Promise<Interest | null> {
    const rows = await persistence.query<InterestRow>(
      `SELECT * FROM interests WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseInterest(rows[0]!);
  }

  async function updateInterest(
    id: string,
    updates: Partial<Pick<Interest, 'name' | 'description' | 'engagementScore' | 'status'>>,
  ): Promise<Interest | null> {
    const setClauses: Array<string> = [];
    const params: Array<string | number> = [];
    let paramIndex = 1;

    if (updates.name !== undefined) {
      setClauses.push(`name = $${paramIndex}`);
      params.push(updates.name);
      paramIndex += 1;
    }

    if (updates.description !== undefined) {
      setClauses.push(`description = $${paramIndex}`);
      params.push(updates.description);
      paramIndex += 1;
    }

    if (updates.engagementScore !== undefined) {
      setClauses.push(`engagement_score = $${paramIndex}`);
      params.push(updates.engagementScore);
      paramIndex += 1;
    }

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      params.push(updates.status);
      paramIndex += 1;
    }

    // Always update last_engaged_at on any update
    setClauses.push(`last_engaged_at = NOW()`);

    if (setClauses.length === 1) {
      // Only last_engaged_at would be updated, which is redundant if nothing else changed
      // But still execute to update timestamp
    }

    const query = `UPDATE interests SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);

    const rows = await persistence.query<InterestRow>(query, params);

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseInterest(rows[0]!);
  }

  async function listInterests(
    owner: string,
    filters?: {
      status?: Interest['status'];
      source?: Interest['source'];
      minScore?: number;
    },
  ): Promise<ReadonlyArray<Interest>> {
    let query = `SELECT * FROM interests WHERE owner = $1`;
    const params: Array<string | number> = [owner];

    if (filters?.status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(filters.status);
    }

    if (filters?.source) {
      query += ` AND source = $${params.length + 1}`;
      params.push(filters.source);
    }

    if (filters?.minScore !== undefined) {
      query += ` AND engagement_score >= $${params.length + 1}`;
      params.push(filters.minScore);
    }

    query += ` ORDER BY engagement_score DESC`;

    const rows = await persistence.query<InterestRow>(query, params);
    return rows.map(parseInterest);
  }

  async function createCuriosityThread(
    thread: Omit<CuriosityThread, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<CuriosityThread> {
    const id = randomUUID();
    const rows = await persistence.query<CuriosityThreadRow>(
      `INSERT INTO curiosity_threads
       (id, interest_id, owner, question, status, resolution)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [id, thread.interestId, thread.owner, thread.question, thread.status, thread.resolution],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseCuriosityThread(rows[0]!);
  }

  async function getCuriosityThread(id: string): Promise<CuriosityThread | null> {
    const rows = await persistence.query<CuriosityThreadRow>(
      `SELECT * FROM curiosity_threads WHERE id = $1`,
      [id],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseCuriosityThread(rows[0]!);
  }

  async function updateCuriosityThread(
    id: string,
    updates: Partial<Pick<CuriosityThread, 'status' | 'resolution'>>,
  ): Promise<CuriosityThread | null> {
    const setClauses: Array<string> = [];
    const params: Array<string | null | number> = [];
    let paramIndex = 1;

    if (updates.status !== undefined) {
      setClauses.push(`status = $${paramIndex}`);
      params.push(updates.status);
      paramIndex += 1;
    }

    if (updates.resolution !== undefined) {
      setClauses.push(`resolution = $${paramIndex}`);
      params.push(updates.resolution);
      paramIndex += 1;
    }

    // Always update updated_at
    setClauses.push(`updated_at = NOW()`);

    const query = `UPDATE curiosity_threads SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    params.push(id);

    const rows = await persistence.query<CuriosityThreadRow>(query, params);

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseCuriosityThread(rows[0]!);
  }

  async function listCuriosityThreads(
    interestId: string,
    filters?: { status?: CuriosityThread['status'] },
  ): Promise<ReadonlyArray<CuriosityThread>> {
    let query = `SELECT * FROM curiosity_threads WHERE interest_id = $1`;
    const params: Array<string> = [interestId];

    if (filters?.status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(filters.status);
    }

    query += ` ORDER BY created_at DESC`;

    const rows = await persistence.query<CuriosityThreadRow>(query, params);
    return rows.map(parseCuriosityThread);
  }

  async function findDuplicateCuriosityThread(
    interestId: string,
    question: string,
  ): Promise<CuriosityThread | null> {
    const rows = await persistence.query<CuriosityThreadRow>(
      `SELECT * FROM curiosity_threads
       WHERE interest_id = $1 AND LOWER(question) = LOWER($2) AND status != 'resolved'
       LIMIT 1`,
      [interestId, question],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseCuriosityThread(rows[0]!);
  }

  async function logExploration(
    entry: Omit<ExplorationLogEntry, 'id' | 'createdAt'>,
  ): Promise<ExplorationLogEntry> {
    const id = randomUUID();
    const rows = await persistence.query<ExplorationLogRow>(
      `INSERT INTO exploration_log
       (id, owner, interest_id, curiosity_thread_id, action, tools_used, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        entry.owner,
        entry.interestId,
        entry.curiosityThreadId,
        entry.action,
        JSON.stringify(entry.toolsUsed),
        entry.outcome,
      ],
    );

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseExplorationLogEntry(rows[0]!);
  }

  async function listExplorationLog(
    owner: string,
    limit?: number,
  ): Promise<ReadonlyArray<ExplorationLogEntry>> {
    const effectiveLimit = limit ?? 20;
    const rows = await persistence.query<ExplorationLogRow>(
      `SELECT * FROM exploration_log WHERE owner = $1 ORDER BY created_at DESC LIMIT $2`,
      [owner, effectiveLimit],
    );

    return rows.map(parseExplorationLogEntry);
  }

  async function applyEngagementDecay(
    owner: string,
    halfLifeDays: number,
  ): Promise<number> {
    const rows = await persistence.query<{ id: string }>(
      `UPDATE interests
       SET engagement_score = engagement_score * pow(0.5, EXTRACT(EPOCH FROM (NOW() - last_engaged_at)) / ($1 * 86400))
       WHERE owner = $2 AND status = 'active'
       RETURNING id`,
      [halfLifeDays, owner],
    );

    return rows.length;
  }

  async function enforceActiveInterestCap(
    owner: string,
    maxActive: number,
  ): Promise<ReadonlyArray<Interest>> {
    return persistence.withTransaction(async (query) => {
      // Step 1: Count active interests
      const countRows = await query<{ count: string }>(
        `SELECT COUNT(*) as count FROM interests WHERE owner = $1 AND status = 'active'`,
        [owner],
      );

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      const activeCount = parseInt(countRows[0]!.count, 10);

      if (activeCount <= maxActive) {
        return [];
      }

      // Step 2: Dormant-ify the lowest-scoring interests
      const excessCount = activeCount - maxActive;
      const rows = await query<InterestRow>(
        `UPDATE interests
         SET status = 'dormant'
         WHERE id IN (
           SELECT id FROM interests
           WHERE owner = $1 AND status = 'active'
           ORDER BY engagement_score ASC
           LIMIT $2
         )
         RETURNING *`,
        [owner, excessCount],
      );

      return rows.map(parseInterest);
    });
  }

  async function bumpEngagement(
    interestId: string,
    amount: number,
  ): Promise<Interest | null> {
    const rows = await persistence.query<InterestRow>(
      `UPDATE interests
       SET engagement_score = engagement_score + $1, last_engaged_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [amount, interestId],
    );

    if (rows.length === 0) {
      return null;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return parseInterest(rows[0]!);
  }

  return {
    createInterest,
    getInterest,
    updateInterest,
    listInterests,
    createCuriosityThread,
    getCuriosityThread,
    updateCuriosityThread,
    listCuriosityThreads,
    findDuplicateCuriosityThread,
    logExploration,
    listExplorationLog,
    applyEngagementDecay,
    enforceActiveInterestCap,
    bumpEngagement,
  };
}
