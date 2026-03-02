// pattern: Imperative Shell

/**
 * PostgreSQL implementation of the TraceRecorder port with fire-and-forget logging.
 * Records operation traces for introspection without blocking on database errors.
 */

import { randomUUID } from 'node:crypto';
import type { PersistenceProvider } from '../persistence/types.ts';
import type { OperationTrace, TraceRecorder, IntrospectionQuery } from './types.ts';

type TraceRow = {
  id: string;
  owner: string;
  conversation_id: string;
  tool_name: string;
  input: Record<string, unknown>;
  output_summary: string;
  duration_ms: number;
  success: boolean;
  error: string | null;
  created_at: string;
};

function parseTrace(row: TraceRow): OperationTrace {
  return {
    id: row.id,
    owner: row.owner,
    conversationId: row.conversation_id,
    toolName: row.tool_name,
    input: row.input,
    outputSummary: row.output_summary,
    durationMs: row.duration_ms,
    success: row.success,
    error: row.error,
    createdAt: new Date(row.created_at),
  };
}

export type TraceStore = TraceRecorder & {
  queryTraces(query: IntrospectionQuery): Promise<ReadonlyArray<OperationTrace>>;
};

export function createTraceRecorder(
  persistence: PersistenceProvider,
): TraceStore {
  async function record(trace: Omit<OperationTrace, 'id' | 'createdAt'>): Promise<void> {
    try {
      const id = randomUUID();
      const truncatedOutput = trace.outputSummary.slice(0, 500);
      await persistence.query(
        `INSERT INTO operation_traces
         (id, owner, conversation_id, tool_name, input, output_summary, duration_ms, success, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          id,
          trace.owner,
          trace.conversationId,
          trace.toolName,
          trace.input,
          truncatedOutput,
          trace.durationMs,
          trace.success,
          trace.error,
        ],
      );
    } catch (error) {
      console.warn('trace recorder: failed to record operation trace', error);
    }
  }

  async function queryTraces(query: IntrospectionQuery): Promise<ReadonlyArray<OperationTrace>> {
    let sql = 'SELECT * FROM operation_traces WHERE owner = $1';
    const params: Array<string | number | Date> = [query.owner];

    if (query.lookbackSince) {
      sql += ` AND created_at >= $${params.length + 1}`;
      params.push(query.lookbackSince);
    }

    if (query.toolName) {
      sql += ` AND tool_name = $${params.length + 1}`;
      params.push(query.toolName);
    }

    if (query.successOnly) {
      sql += ' AND success = true';
    }

    sql += ' ORDER BY created_at DESC';

    const limit = query.limit ?? 100;
    sql += ` LIMIT $${params.length + 1}`;
    params.push(limit);

    const rows = await persistence.query<TraceRow>(sql, params);
    return rows.map(parseTrace);
  }

  return {
    record,
    queryTraces,
  };
}
