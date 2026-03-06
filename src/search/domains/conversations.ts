// pattern: Imperative Shell

import { toSql } from 'pgvector/utils';
import type { PersistenceProvider } from '../../persistence/types.ts';
import type { DomainSearchParams, DomainSearchResult, SearchDomain } from '../types.ts';

type ConversationSearchRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
  score: number;
};

export function createConversationSearchDomain(persistence: PersistenceProvider): SearchDomain {
  async function search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>> {
    const { query, mode, embedding, limit, startTime, endTime, role } = params;

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
          SELECT id, conversation_id, role, content, created_at,
                 ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
          FROM messages
          WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})`;

        queryParams.push(query);
        paramIndex = 2;

        if (role) {
          sql += ` AND role = $${paramIndex}`;
          queryParams.push(role);
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
            SELECT id, conversation_id, role, content, created_at,
                   ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
            FROM messages
            WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})`;

        queryParams.push(query);
        paramIndex = 2;

        if (role) {
          sql += ` AND role = $${paramIndex}`;
          queryParams.push(role);
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
            SELECT id, conversation_id, role, content, created_at,
                   (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
            FROM messages
            WHERE embedding IS NOT NULL`;

        queryParams.push(limit);
        paramIndex += 1;

        if (role) {
          sql += ` AND role = $${paramIndex}`;
          queryParams.push(role);
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
        SELECT id, conversation_id, role, content, created_at,
               ts_rank(search_vector, plainto_tsquery('english', $${paramIndex})) AS score
        FROM messages
        WHERE search_vector @@ plainto_tsquery('english', $${paramIndex})`;

      queryParams.push(query);
      paramIndex = 2;

      if (role) {
        sql += ` AND role = $${paramIndex}`;
        queryParams.push(role);
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
        SELECT id, conversation_id, role, content, created_at,
               (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score
        FROM messages
        WHERE embedding IS NOT NULL`;

      paramIndex = 1;

      if (role) {
        sql += ` AND role = $${paramIndex}`;
        queryParams.push(role);
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

    const rows = await persistence.query<ConversationSearchRow>(sql, queryParams);

    return rows.map((row) => ({
      id: row.id,
      domain: 'conversations' as const,
      content: row.content,
      score: row.score,
      metadata: {
        tier: null,
        label: null,
        role: row.role,
        conversationId: row.conversation_id,
      },
      createdAt: new Date(row.created_at),
    }));
  }

  return {
    name: 'conversations' as const,
    search,
  };
}
