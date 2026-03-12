// pattern: Imperative Shell

import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../../persistence/types.ts';
import type { DomainSearchParams, DomainSearchResult, SearchDomain } from '../types.ts';

type MemoryBlockSearchRow = {
  id: string;
  content: string;
  tier: string;
  label: string;
  created_at: string;
  score: number;
};

export function createMemorySearchDomain(
  persistence: PersistenceProvider,
  owner: string,
): SearchDomain {
  async function search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>> {
    const { query, mode, embedding, limit, startTime, endTime, tier } = params;

    // Semantic mode requires an embedding
    if (mode === 'semantic' && !embedding) {
      throw new Error('Semantic search requires an embedding');
    }

    let sql: string;
    const queryParams: Array<unknown> = [];
    let paramIndex = 1;

    if (mode === 'hybrid') {
      // Hybrid mode: if no embedding, degrade to keyword-only
      if (!embedding) {
        // Fall through to keyword-only logic
        sql = `
          SELECT id, content, tier, label, created_at,
                 ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
          FROM memory_blocks
          WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})
            AND owner = $${paramIndex + 1}`;

        queryParams.push(query, owner);
        paramIndex = 3;

        if (tier) {
          sql += ` AND tier = $${paramIndex}`;
          queryParams.push(tier);
          paramIndex += 1;
        }

        if (startTime) {
          sql += ` AND created_at >= $${paramIndex}`;
          queryParams.push(startTime);
          paramIndex += 1;
        }

        if (endTime) {
          sql += ` AND created_at <= $${paramIndex}`;
          queryParams.push(endTime);
          paramIndex += 1;
        }

        sql += `
          ORDER BY score DESC
          LIMIT $${paramIndex}`;

        queryParams.push(limit);
      } else {
        // Both keyword and vector CTEs
        sql = `
          WITH keyword_results AS (
            SELECT id, content, tier, label, created_at,
                   ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
            FROM memory_blocks
            WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})
              AND owner = $${paramIndex + 1}`;

        queryParams.push(query, owner);
        paramIndex = 3;

        if (tier) {
          sql += ` AND tier = $${paramIndex}`;
          queryParams.push(tier);
          paramIndex += 1;
        }

        if (startTime) {
          sql += ` AND created_at >= $${paramIndex}`;
          queryParams.push(startTime);
          paramIndex += 1;
        }

        if (endTime) {
          sql += ` AND created_at <= $${paramIndex}`;
          queryParams.push(endTime);
          paramIndex += 1;
        }

        sql += `
            ORDER BY score DESC
            LIMIT $${paramIndex}
          ),
          vector_results AS (
            SELECT id, content, tier, label, created_at,
                   (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
            FROM memory_blocks
            WHERE embedding IS NOT NULL
              AND owner = $${paramIndex + 1}`;

        queryParams.push(limit, owner);
        paramIndex += 2;

        if (tier) {
          sql += ` AND tier = $${paramIndex}`;
          queryParams.push(tier);
          paramIndex += 1;
        }

        if (startTime) {
          sql += ` AND created_at >= $${paramIndex}`;
          queryParams.push(startTime);
          paramIndex += 1;
        }

        if (endTime) {
          sql += ` AND created_at <= $${paramIndex}`;
          queryParams.push(endTime);
          paramIndex += 1;
        }

        sql += `
            ORDER BY score DESC
            LIMIT $${paramIndex}
          )
          SELECT * FROM keyword_results
          UNION ALL
          SELECT * FROM vector_results`;

        queryParams.push(limit);
      }
    } else if (mode === 'keyword') {
      // Keyword only
      sql = `
        SELECT id, content, tier, label, created_at,
               ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
        FROM memory_blocks
        WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})
          AND owner = $${paramIndex + 1}`;

      queryParams.push(query, owner);
      paramIndex = 3;

      if (tier) {
        sql += ` AND tier = $${paramIndex}`;
        queryParams.push(tier);
        paramIndex += 1;
      }

      if (startTime) {
        sql += ` AND created_at >= $${paramIndex}`;
        queryParams.push(startTime);
        paramIndex += 1;
      }

      if (endTime) {
        sql += ` AND created_at <= $${paramIndex}`;
        queryParams.push(endTime);
        paramIndex += 1;
      }

      sql += `
        ORDER BY score DESC
        LIMIT $${paramIndex}`;

      queryParams.push(limit);
    } else {
      // Semantic only - embedding is guaranteed by the check at the top
      sql = `
        SELECT id, content, tier, label, created_at,
               (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
        FROM memory_blocks
        WHERE embedding IS NOT NULL
          AND owner = $${paramIndex}`;

      queryParams.push(owner);
      paramIndex = 2;

      if (tier) {
        sql += ` AND tier = $${paramIndex}`;
        queryParams.push(tier);
        paramIndex += 1;
      }

      if (startTime) {
        sql += ` AND created_at >= $${paramIndex}`;
        queryParams.push(startTime);
        paramIndex += 1;
      }

      if (endTime) {
        sql += ` AND created_at <= $${paramIndex}`;
        queryParams.push(endTime);
        paramIndex += 1;
      }

      sql += `
        ORDER BY score DESC
        LIMIT $${paramIndex}`;

      queryParams.push(limit);
    }

    const rows = await persistence.query<MemoryBlockSearchRow>(sql, queryParams);

    return rows.map((row) => ({
      id: row.id,
      domain: 'memory' as const,
      content: row.content,
      score: row.score,
      metadata: {
        tier: row.tier,
        label: row.label,
        role: null,
        conversationId: null,
      },
      createdAt: new Date(row.created_at),
    }));
  }

  return {
    name: 'memory' as const,
    search,
  };
}
