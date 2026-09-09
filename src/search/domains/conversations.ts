// pattern: Imperative Shell

import {toSql} from 'pgvector/utils';
import type {PersistenceProvider} from '../../persistence/types.ts';
import type {DomainSearchParams, DomainSearchResult, SearchDomain} from '../types.ts';

type ConversationSearchRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: string;
  readonly content: string;
  readonly created_at: string;
  readonly score: number;
  readonly history_status: 'active' | 'historical' | 'superseded';
};

function createProjection(history: DomainSearchParams['history']): string {
  if (history === 'historical') {
    return `(SELECT m.*, CASE WHEN h.message_id IS NULL THEN 'superseded'::text ELSE 'historical'::text END AS history_status
                FROM messages m
                LEFT JOIN conversation_history_membership h
                  ON h.conversation_id = m.conversation_id AND h.message_id = m.id
               WHERE h.message_id IS NULL) AS messages`;
  }
  if (history === 'all') {
    return `(SELECT m.*, CASE WHEN h.message_id IS NULL THEN 'superseded'::text ELSE 'active'::text END AS history_status
                FROM messages m
                LEFT JOIN conversation_history_membership h
                  ON h.conversation_id = m.conversation_id AND h.message_id = m.id) AS messages`;
  }
  return `(SELECT m.*, 'active'::text AS history_status
             FROM conversation_history_membership h
             JOIN messages m
               ON m.conversation_id = h.conversation_id AND m.id = h.message_id) AS messages`;
}

function appendFilters(
  sql: string,
  queryParams: Array<unknown>,
  role: string | null,
  startTime: Date | null,
  endTime: Date | null,
): {readonly sql: string; readonly queryParams: Array<unknown>; readonly nextIndex: number} {
  let nextIndex = queryParams.length + 1;
  let result = sql;
  if (role) {
    result += ` AND role = $${nextIndex}`;
    queryParams.push(role);
    nextIndex += 1;
  }
  if (startTime) {
    result += ` AND created_at >= $${nextIndex}`;
    queryParams.push(startTime);
    nextIndex += 1;
  }
  if (endTime) {
    result += ` AND created_at <= $${nextIndex}`;
    queryParams.push(endTime);
    nextIndex += 1;
  }
  return {sql: result, queryParams, nextIndex};
}

export function createConversationSearchDomain(persistence: PersistenceProvider): SearchDomain {
  async function search(params: DomainSearchParams): Promise<ReadonlyArray<DomainSearchResult>> {
    const {query, mode, embedding, limit, startTime, endTime, role} = params;
    if (mode === 'semantic' && !embedding) throw new Error('Semantic search requires an embedding');
    const projection = createProjection(params.history);
    let sql: string;
    const queryParams: Array<unknown> = [];

    if (mode === 'hybrid' && embedding) {
      queryParams.push(query);
      sql = `WITH keyword_results AS (
        SELECT id, conversation_id, role, content, created_at,
               ts_rank(search_vector, plainto_tsquery('english', $1)) AS score,
               history_status
          FROM ${projection}
         WHERE search_vector @@ plainto_tsquery('english', $1)`;
      const keywordFilters = appendFilters(sql, queryParams, role, startTime, endTime);
      sql = `${keywordFilters.sql}
         ORDER BY score DESC LIMIT $${keywordFilters.nextIndex}),
      vector_results AS (`;
      queryParams.push(limit);
      sql += `
        SELECT id, conversation_id, role, content, created_at,
               (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score,
               history_status
          FROM ${projection}
         WHERE embedding IS NOT NULL`;
      const vectorFilters = appendFilters(sql, queryParams, role, startTime, endTime);
      sql = `${vectorFilters.sql}
         ORDER BY score DESC LIMIT $${vectorFilters.nextIndex})
      SELECT * FROM keyword_results
      UNION ALL
      SELECT * FROM vector_results`;
      queryParams.push(limit);
    } else if (mode === 'semantic') {
      sql = `SELECT id, conversation_id, role, content, created_at,
                    (1 - (embedding <=> '${toSql(embedding)}'::vector)) AS score,
                    history_status
               FROM ${projection}
              WHERE embedding IS NOT NULL`;
      const filters = appendFilters(sql, queryParams, role, startTime, endTime);
      sql = `${filters.sql} ORDER BY score DESC LIMIT $${filters.nextIndex}`;
      queryParams.push(limit);
    } else {
      queryParams.push(query);
      sql = `SELECT id, conversation_id, role, content, created_at,
                    ts_rank(search_vector, plainto_tsquery('english', $1)) AS score,
                    history_status
               FROM ${projection}
              WHERE search_vector @@ plainto_tsquery('english', $1)`;
      const filters = appendFilters(sql, queryParams, role, startTime, endTime);
      sql = `${filters.sql} ORDER BY score DESC LIMIT $${filters.nextIndex}`;
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
        historyStatus: row.history_status,
      },
      createdAt: new Date(row.created_at),
    }));
  }

  return {name: 'conversations' as const, search};
}
