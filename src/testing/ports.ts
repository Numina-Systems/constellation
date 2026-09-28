// pattern: Functional Core

import type {PersistenceProvider, QueryFunction, TransactionScope} from '@/persistence/types.ts';
import type {ToolOutcome, TransactionOutcome, TransactionReconciliation} from '@/contracts/outcomes.ts';

export type FailureInjection = {
  readonly operation: 'query' | 'commit' | 'rollback' | 'publication';
  readonly error: Error;
  readonly commandTag?: 'COMMIT' | 'ROLLBACK';
  readonly when?: 'inside_transaction' | 'outside_transaction';
  /** Optional SQL filter; a query injection fires only when the statement matches. */
  readonly sqlPattern?: RegExp;
};

type Row = Readonly<Record<string, unknown>>;
type TransactionFrame = {
  readonly rows: Map<string, Array<Row>>;
  readonly publications: Array<() => void | Promise<void>>;
};

export type TestPersistence = Omit<PersistenceProvider, 'withTransactionOutcome'> & {
  readonly withTransactionOutcome: NonNullable<PersistenceProvider['withTransactionOutcome']>;
  readonly rows: ReadonlyMap<string, Array<Row>>;
  readonly failures: Array<FailureInjection>;
};

function cloneRows(source: ReadonlyMap<string, Array<Row>>): Map<string, Array<Row>> {
  return new Map(Array.from(source.entries(), ([table, tableRows]) => [table, tableRows.map((row) => ({...row}))]));
}

function activeRows(rows: Map<string, Array<Row>>, frames: ReadonlyArray<TransactionFrame>): Map<string, Array<Row>> {
  return frames.length > 0 ? frames[frames.length - 1]!.rows : rows;
}

function tableFromSql(sql: string): string | null {
  return /(?:FROM|INTO|UPDATE|TABLE|DELETE\s+FROM)\s+([a-z_][a-z0-9_]*)/i.exec(sql)?.[1]?.toLowerCase() ?? null;
}

// Column fidelity for the fake, mirroring migrations 001/003/010/015/016. SELECT
// statements are validated against this map so a query referencing a column the
// real schema does not have fails in tests exactly as it would on PostgreSQL.
const TABLE_COLUMNS: Readonly<Record<string, ReadonlyArray<string>>> = {
  messages: ['id', 'conversation_id', 'role', 'content', 'tool_calls', 'tool_call_id', 'reasoning_content', 'embedding', 'created_at'],
  operation_receipts: ['operation_id', 'operation_type', 'status', 'details', 'created_at', 'updated_at'],
  conversation_history_state: ['conversation_id', 'revision', 'updated_at'],
  conversation_history_membership: ['conversation_id', 'message_id', 'position'],
  conversation_history_provenance: ['operation_id', 'conversation_id', 'source_message_ids', 'source_archive_ids', 'previous_revision', 'new_revision', 'summary_message_id', 'supersedes_operation_id', 'created_at'],
  conversation_history_archive_refs: ['operation_id', 'archive_block_id'],
  memory_blocks: ['id', 'owner', 'tier', 'label', 'content', 'embedding', 'permission', 'pinned', 'history_owned', 'history_owner_operation_id', 'created_at', 'updated_at'],
  session_checkpoints: ['id', 'conversation_id', 'checkpoint_data', 'created_at', 'updated_at'],
};

const SQL_CLAUSE_KEYWORDS: ReadonlySet<string> = new Set([
  'where', 'group', 'order', 'limit', 'offset', 'on', 'set', 'as', 'left', 'right', 'inner', 'outer', 'cross',
  'join', 'values', 'returning', 'for', 'update', 'and', 'or', 'not', 'when', 'then', 'else', 'end', 'with',
  'union', 'select', 'from', 'asc', 'desc', 'case', 'distinct', 'into', 'default', 'using', 'exists', 'by',
  'all', 'any', 'between', 'in', 'is', 'null', 'having',
]);

/**
 * Rejects SELECT statements that reference columns absent from the fake's schema.
 * Conservative by design: statements touching tables outside TABLE_COLUMNS are
 * skipped, and only plain (possibly qualified) column references are checked.
 */
function validateSelectColumns(sql: string): void {
  if (!/^SELECT\b/i.test(sql)) return;
  const tables = new Map<string, string>();
  let sawUnknownTable = false;
  for (const match of sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)(?:\s+(?:AS\s+)?([a-z_][a-z0-9_]*))?/gi)) {
    const table = match[1]!.toLowerCase();
    if (TABLE_COLUMNS[table] === undefined) {
      sawUnknownTable = true;
      continue;
    }
    const aliasCandidate = (match[2] ?? '').toLowerCase();
    // A keyword candidate means the table carried no alias; keep the table itself.
    const alias = aliasCandidate === '' || SQL_CLAUSE_KEYWORDS.has(aliasCandidate) ? table : aliasCandidate;
    tables.set(alias, table);
  }
  if (sawUnknownTable) return;
  const knownColumns = new Set<string>();
  for (const table of new Set(tables.values())) {
    for (const column of TABLE_COLUMNS[table] ?? []) knownColumns.add(column);
  }
  for (const match of sql.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g)) {
    const table = tables.get(match[1]!.toLowerCase());
    if (table === undefined) continue;
    if (!(TABLE_COLUMNS[table] ?? []).includes(match[2]!.toLowerCase())) {
      throw new Error(`unknown column ${String(match[1])}.${String(match[2])} on ${table} (test schema mismatch)`);
    }
  }
  const selectListMatch = /^SELECT\s+(?:DISTINCT\s+)?([\s\S]+?)\s+FROM\b/i.exec(sql);
  if (!selectListMatch) return;
  for (const entry of selectListMatch[1]!.split(',')) {
    const bare = entry.trim().replace(/\s+AS\s+[a-z_][a-z0-9_]*$/i, '').trim();
    if (/^[a-z_][a-z0-9_]*$/i.test(bare) && !SQL_CLAUSE_KEYWORDS.has(bare.toLowerCase())
      && knownColumns.size > 0 && !knownColumns.has(bare.toLowerCase())) {
      throw new Error(`unknown column ${bare} in select list (test schema mismatch)`);
    }
  }
}

function parameter(params: ReadonlyArray<unknown>, index: number): unknown {
  return params[index] ?? null;
}

function textParameter(params: ReadonlyArray<unknown>, index: number): string {
  return String(parameter(params, index));
}

function messageRows(rows: Map<string, Array<Row>>, conversationId: string): Array<Row> {
  return (rows.get('messages') ?? []).filter((row) => row['conversation_id'] === conversationId);
}

function activeMembership(rows: Map<string, Array<Row>>, conversationId: string): Array<Row> {
  return (rows.get('conversation_history_membership') ?? [])
    .filter((row) => row['conversation_id'] === conversationId)
    .toSorted((left, right) => Number(left['position'] ?? 0) - Number(right['position'] ?? 0));
}

function timestampMilliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return new Date(String(value)).getTime();
}

function parseStoredValue(column: string, value: unknown): unknown {
  if ((column === 'tool_calls' || column === 'checkpoint_data' || column === 'details') && typeof value === 'string') {
    try { return JSON.parse(value) as unknown; } catch { return value; }
  }
  return value;
}

function messageProjection(row: Row, historyStatus?: 'active' | 'historical' | 'superseded'): Row {
  return {
    id: row['id'], conversation_id: row['conversation_id'], role: row['role'], content: row['content'],
    tool_calls: row['tool_calls'] ?? null, tool_call_id: row['tool_call_id'] ?? null,
    reasoning_content: row['reasoning_content'] ?? null, created_at: row['created_at'],
    ...(historyStatus === undefined ? {} : {history_status: historyStatus}),
  };
}

function applySql(rows: Map<string, Array<Row>>, sql: string, params: ReadonlyArray<unknown>): Array<Row> {
  const normalized = sql.trim();
  validateSelectColumns(normalized);
  const selectLiteral = /^SELECT\s+([0-9]+)\s+AS\s+([a-z_][a-z0-9_]*)/i.exec(normalized);
  if (selectLiteral) return [{[selectLiteral[2]!.toLowerCase()]: Number(selectLiteral[1])}];

  if (/^INSERT INTO operation_receipts/i.test(normalized) && /'agent_batch'/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const rawDetails = parameter(params, 1);
    const details = typeof rawDetails === 'string' ? parseStoredValue('details', rawDetails) : rawDetails;
    const receipts = rows.get('operation_receipts') ?? [];
    const existing = receipts.find((row) => row['operation_id'] === operationId);
    const value = {operation_id: operationId, operation_type: 'agent_batch', status: 'committed', details: details ?? {}};
    if (existing) receipts.splice(receipts.indexOf(existing), 1, value); else receipts.push(value);
    rows.set('operation_receipts', receipts);
    return [];
  }
  if (/^INSERT INTO operation_receipts/i.test(normalized) && /'turn_counter'/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const rawDetails = parameter(params, 1);
    const details = typeof rawDetails === 'string' ? parseStoredValue('details', rawDetails) : rawDetails;
    const receipts = rows.get('operation_receipts') ?? [];
    const existing = receipts.find((row) => row['operation_id'] === operationId);
    const value = {operation_id: operationId, operation_type: 'turn_counter', status: 'committed', details: details ?? {}};
    if (existing) receipts.splice(receipts.indexOf(existing), 1, value); else receipts.push(value);
    rows.set('operation_receipts', receipts);
    return [];
  }
  if (/^INSERT INTO operation_receipts/i.test(normalized) && /operation_type = 'compaction_intent'/i.test(normalized)) {
    const conversationId = textParameter(params, 2);
    const receipts = rows.get('operation_receipts') ?? [];
    const alreadyPending = receipts.some((row) => {
      const details = row['details'];
      return row['operation_type'] === 'compaction_intent' && typeof details === 'object' && details !== null
        && (details as Record<string, unknown>)['conversationId'] === conversationId
        && (details as Record<string, unknown>)['consumed'] === false;
    });
    if (!alreadyPending) receipts.push({operation_id: textParameter(params, 0), operation_type: 'compaction_intent', status: 'committed', details: JSON.parse(textParameter(params, 1)) as unknown});
    rows.set('operation_receipts', receipts);
    return [];
  }
  if (/^INSERT INTO operation_receipts.*checkpoint_restore/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const details = parseStoredValue('checkpoint_data', parameter(params, 1));
    const receipts = rows.get('operation_receipts') ?? [];
    receipts.push({operation_id: operationId, operation_type: 'checkpoint_restore', status: 'committed', details});
    rows.set('operation_receipts', receipts);
    return [];
  }
  if (/^INSERT INTO conversation_history_provenance/i.test(normalized)) {
    const provenance = rows.get('conversation_history_provenance') ?? [];
    const operationId = parameter(params, 0);
    const operationType = (rows.get('operation_receipts') ?? []).find((receipt) => receipt['operation_id'] === operationId)?.['operation_type'] ?? 'compaction';
    provenance.push({operation_id: operationId, conversation_id: parameter(params, 1), source_message_ids: parameter(params, 2), source_archive_ids: parameter(params, 3), previous_revision: parameter(params, 4), new_revision: parameter(params, 5), summary_message_id: parameter(params, 6), operation_type: operationType});
    rows.set('conversation_history_provenance', provenance);
    return [];
  }
  const insert = /^INSERT\s+INTO\s+([a-z_][a-z0-9_]*)\s*\(([^)]+)\)\s+VALUES\s*\(([^)]+)\)/i.exec(normalized);
  if (insert) {
    const columns = insert[2]!.split(',').map((column) => column.trim().toLowerCase());
    const row: Record<string, unknown> = {};
    columns.forEach((column, index) => { row[column] = parseStoredValue(column, parameter(params, index)); });
    const table = insert[1]!.toLowerCase();
    if (table === 'operation_receipts') {
      row['operation_type'] = /checkpoint_restore/i.test(normalized)
        ? 'checkpoint_restore'
        : /turn_counter/i.test(normalized)
          ? 'turn_counter'
          : /compaction_intent/i.test(normalized)
            ? 'compaction_intent'
            : /agent_batch/i.test(normalized)
              ? 'agent_batch'
              : 'compaction';
      row['status'] = 'committed';
      const details = row['details'];
      row['details'] = typeof details === 'string' ? parseStoredValue('details', details) : (details ?? {});
    }
    if (table === 'memory_blocks') {
      row['tier'] = 'archival';
      row['permission'] = 'readonly';
      row['pinned'] = true;
      row['history_owned'] = true;
    }
    const tableRows = rows.get(table) ?? [];
    if (table === 'operation_receipts') {
      const operationId = row['operation_id'];
      const existing = tableRows.find((candidate) => candidate['operation_id'] === operationId);
      if (existing) {
        tableRows.splice(tableRows.indexOf(existing), 1, {...existing, ...row});
      } else {
        tableRows.push(row);
      }
    } else {
      tableRows.push(row);
    }
    rows.set(table, tableRows);
    if (table === 'messages') {
      const conversationId = textParameter(params, columns.indexOf('conversation_id'));
      const messageId = textParameter(params, columns.indexOf('id'));
      const membership = rows.get('conversation_history_membership') ?? [];
      const state = rows.get('conversation_history_state') ?? [];
      if (!state.some((item) => item['conversation_id'] === conversationId)) state.push({conversation_id: conversationId, revision: 0});
      const positions = activeMembership(rows, conversationId).map((item) => Number(item['position'] ?? 0));
      const position = positions.length === 0 ? 0 : Math.max(...positions) + 1;
      membership.push({conversation_id: conversationId, message_id: messageId, position});
      rows.set('conversation_history_membership', membership);
      const stateRow = state.find((item) => item['conversation_id'] === conversationId);
      if (stateRow) {
        state.splice(state.indexOf(stateRow), 1, {...stateRow, revision: Number(stateRow['revision'] ?? 0) + 1});
      }
      rows.set('conversation_history_state', state);
    }
    return [];
  }

  if (/^SELECT\s+operation_id,\s*status,\s*details\s+FROM\s+operation_receipts\s+WHERE\s+operation_id\s*=\s*\$1/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    return (rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_id'] === operationId)
      .map((row) => ({operation_id: row['operation_id'], status: row['status'], details: row['details']}));
  }
  if (/^SELECT\s+details\s+FROM\s+operation_receipts\s+WHERE\s+operation_type\s*=\s*'agent_batch'/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    // Mirrors the production predicates: optional marker-kind filter and the
    // unfinished-only filter used by recovery scans.
    const markerKindParam = /\(details->>'markerKind'\) = \$2/i.test(normalized) ? textParameter(params, 1) : null;
    const excludesMarkers = /\(details->>'markerKind'\) IS NULL/i.test(normalized);
    const unfinishedOnly = /IS DISTINCT FROM 'true'/i.test(normalized);
    return (rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_type'] === 'agent_batch')
      .filter((row) => {
        const details = row['details'];
        if (typeof details !== 'object' || details === null) return false;
        const record = details as Record<string, unknown>;
        if (record['conversationId'] !== conversationId) return false;
        if (markerKindParam !== null && record['markerKind'] !== markerKindParam) return false;
        if (excludesMarkers && record['markerKind'] !== undefined) return false;
        if (unfinishedOnly && record['completed'] === true && record['recoveryRequired'] !== true) return false;
        return true;
      })
      .map((row) => ({details: row['details']}));
  }
  if (/^SELECT\s+operation_id,\s*operation_type,\s*status,\s*details\s+FROM\s+operation_receipts\s+WHERE\s+operation_id/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const scopedToConversation = /details->>'conversationId'\s*=\s*\$2/i.test(normalized);
    return (rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_id'] === operationId)
      .filter((row) => {
        if (!scopedToConversation) return true;
        const details = row['details'];
        return typeof details === 'object' && details !== null && (details as Record<string, unknown>)['conversationId'] === textParameter(params, 1);
      })
      .map((row) => ({operation_id: row['operation_id'], operation_type: row['operation_type'], status: row['status'], details: row['details']}));
  }
  if (/^SELECT operation_id FROM operation_receipts/i.test(normalized) && /operation_type = 'compaction_intent'/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    return (rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_type'] === 'compaction_intent')
      .filter((row) => {
        const details = row['details'];
        return typeof details === 'object' && details !== null
          && (details as Record<string, unknown>)['conversationId'] === conversationId
          && (details as Record<string, unknown>)['consumed'] === false;
      })
      .sort((left, right) => String(left['operation_id']).localeCompare(String(right['operation_id'])))
      .slice(0, 1)
      .map((row) => ({operation_id: row['operation_id']}));
  }
  if (/^SELECT revision FROM conversation_history_state/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    return (rows.get('conversation_history_state') ?? []).filter((row) => row['conversation_id'] === conversationId);
  }
  if (/^SELECT checkpoint_data FROM session_checkpoints WHERE id/i.test(normalized)) {
    const checkpointId = textParameter(params, 0);
    return (rows.get('session_checkpoints') ?? []).filter((row) => row['id'] === checkpointId).map((row) => ({checkpoint_data: row['checkpoint_data']}));
  }
  if (/^SELECT id, conversation_id FROM messages WHERE id = ANY/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const ids = (parameter(params, 1) as Array<unknown>).map(String);
    return messageRows(rows, conversationId).filter((row) => ids.includes(String(row['id']))).map((row) => ({id: row['id'], conversation_id: row['conversation_id']}));
  }
  if (/^SELECT id, conversation_id, role, content, tool_calls/i.test(normalized) && /FROM messages WHERE id/i.test(normalized)) {
    const id = textParameter(params, 0);
    const conversationId = textParameter(params, 1);
    return messageRows(rows, conversationId).filter((row) => row['id'] === id).map((row) => messageProjection(row));
  }
  if (/^SELECT message_id FROM conversation_history_membership/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    return activeMembership(rows, conversationId).map((row) => ({message_id: row['message_id']}));
  }
  if (/FROM conversation_history_membership h/i.test(normalized) && /JOIN messages m/i.test(normalized) && /NOT EXISTS/i.test(normalized) && /operation_receipts/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const activeIds = new Set(activeMembership(rows, conversationId).map((row) => String(row['message_id'])));
    // Current-lineage rule: a source is excluded only while the compaction that
    // consumed it still owns the active summary; an exact restore that reactivates
    // sources retires the old lineage and makes them compactable again.
    const excludedMessageIds = new Set((rows.get('conversation_history_provenance') ?? [])
      .filter((provenance) => {
        if (!Array.isArray(provenance['source_message_ids'])) return false;
        const receipt = (rows.get('operation_receipts') ?? []).find((candidate) => candidate['operation_id'] === provenance['operation_id']);
        return receipt?.['operation_type'] === 'compaction' && receipt?.['status'] === 'committed'
          && activeIds.has(String(provenance['summary_message_id']));
      })
      .flatMap((provenance) => (provenance['source_message_ids'] as Array<unknown>).map(String)));
    const byId = new Map(messageRows(rows, conversationId).map((row) => [String(row['id']), row]));
    return activeMembership(rows, conversationId).flatMap((membership) => {
      const row = byId.get(String(membership['message_id']));
      return row && !excludedMessageIds.has(String(row['id'])) ? [messageProjection(row)] : [];
    });
  }
  if (/FROM conversation_history_membership h/i.test(normalized) && /JOIN messages m/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const byId = new Map(messageRows(rows, conversationId).map((row) => [String(row['id']), row]));
    return activeMembership(rows, conversationId).flatMap((membership) => {
      const row = byId.get(String(membership['message_id']));
      return row ? [messageProjection(row)] : [];
    });
  }
  if (/FROM unnest\(\$2::text\[\]\)/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const ids = (parameter(params, 1) as Array<unknown>).map(String);
    const byId = new Map(messageRows(rows, conversationId).map((row) => [String(row['id']), row]));
    return ids.flatMap((id, index) => {
      const row = byId.get(id);
      return row ? [{...messageProjection(row), requested_position: index + 1}] : [];
    });
  }
  if (/FROM messages m/i.test(normalized) && /LEFT JOIN conversation_history_membership h/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const limit = Number(parameter(params, 1));
    const membershipIds = new Set(activeMembership(rows, conversationId).map((row) => String(row['message_id'])));
    const result = messageRows(rows, conversationId)
      .toSorted((left, right) => timestampMilliseconds(right['created_at']) - timestampMilliseconds(left['created_at']) || String(right['id']).localeCompare(String(left['id'])))
      .slice(0, limit)
      .map((row) => messageProjection(row, membershipIds.has(String(row['id'])) ? 'historical' : 'superseded'));
    return result;
  }
  if (/FROM messages m/i.test(normalized) && /WHERE h\.message_id IS NULL/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const limit = Number(parameter(params, 1));
    const membershipIds = new Set(activeMembership(rows, conversationId).map((row) => String(row['message_id'])));
    return messageRows(rows, conversationId).filter((row) => !membershipIds.has(String(row['id'])))
      .toSorted((left, right) => timestampMilliseconds(right['created_at']) - timestampMilliseconds(left['created_at']) || String(right['id']).localeCompare(String(left['id'])))
      .slice(0, limit).map((row) => messageProjection(row, 'superseded'));
  }
  if (/FROM messages m/i.test(normalized) && /NOT EXISTS/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const limit = Number(parameter(params, 1));
    const activeIds = new Set(activeMembership(rows, conversationId).map((row) => String(row['message_id'])));
    const sourceIds = new Set((rows.get('conversation_history_provenance') ?? [])
      .filter((provenance) => {
        if (!Array.isArray(provenance['source_message_ids'])) return false;
        const receipt = (rows.get('operation_receipts') ?? []).find((candidate) => candidate['operation_id'] === provenance['operation_id']);
        return receipt?.['operation_type'] === 'compaction' && receipt?.['status'] === 'committed'
          && activeIds.has(String(provenance['summary_message_id']));
      })
      .flatMap((row) => (row['source_message_ids'] as Array<unknown>).map(String)));
    const byId = new Map(messageRows(rows, conversationId).map((row) => [String(row['id']), row]));
    return activeMembership(rows, conversationId).flatMap((membership) => {
      const id = String(membership['message_id']);
      const row = byId.get(id);
      return row && !sourceIds.has(id) ? [messageProjection(row)] : [];
    }).slice(0, limit);
  }
  if (/^SELECT operation_id, status, details FROM operation_receipts WHERE operation_id/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    return (rows.get('operation_receipts') ?? [])
      .filter((row) => row['operation_id'] === operationId)
      .map((row) => ({operation_id: row['operation_id'], status: row['status'], details: row['details']}));
  }
  if (/^DELETE FROM conversation_history_membership WHERE conversation_id = \$1$/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const existing = rows.get('conversation_history_membership') ?? [];
    rows.set('conversation_history_membership', existing.filter((row) => row['conversation_id'] !== conversationId));
    return [];
  }
  if (/^DELETE FROM conversation_history_membership/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const ids = new Set((parameter(params, 1) as Array<unknown>).map(String));
    const existing = rows.get('conversation_history_membership') ?? [];
    rows.set('conversation_history_membership', existing.filter((row) => row['conversation_id'] !== conversationId || !ids.has(String(row['message_id']))));
    return [];
  }
  if (/^INSERT INTO conversation_history_membership/i.test(normalized)) {
    const membership = rows.get('conversation_history_membership') ?? [];
    const conversationId = textParameter(params, 0);
    const messageId = textParameter(params, 1);
    const position = Number(parameter(params, 2));
    const existing = membership.find((row) => row['conversation_id'] === conversationId && row['message_id'] === messageId);
    if (existing) {
      const index = membership.indexOf(existing);
      membership.splice(index, 1, {...existing, position});
    } else membership.push({conversation_id: conversationId, message_id: messageId, position});
    rows.set('conversation_history_membership', membership);
    return [];
  }
  if (/^INSERT INTO operation_receipts.*checkpoint_restore/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const details = JSON.parse(textParameter(params, 1)) as unknown;
    const receipts = rows.get('operation_receipts') ?? [];
    receipts.push({operation_id: operationId, operation_type: 'checkpoint_restore', status: 'committed', details});
    rows.set('operation_receipts', receipts);
    return [];
  }
  if (/^INSERT INTO conversation_history_archive_refs/i.test(normalized)) {
    const refs = rows.get('conversation_history_archive_refs') ?? [];
    refs.push({operation_id: parameter(params, 0), archive_block_id: parameter(params, 1)});
    rows.set('conversation_history_archive_refs', refs);
    return [];
  }
  if (/^INSERT INTO conversation_history_provenance/i.test(normalized)) {
    const provenance = rows.get('conversation_history_provenance') ?? [];
    const operationId = parameter(params, 0);
    const operationType = (rows.get('operation_receipts') ?? []).find((receipt) => receipt['operation_id'] === operationId)?.['operation_type'] ?? 'compaction';
    provenance.push({operation_id: operationId, conversation_id: parameter(params, 1), source_message_ids: parameter(params, 2), source_archive_ids: parameter(params, 3), previous_revision: parameter(params, 4), new_revision: parameter(params, 5), summary_message_id: parameter(params, 6), operation_type: operationType});
    rows.set('conversation_history_provenance', provenance);
    return [];
  }
  if (/^INSERT INTO conversation_history_state/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const revision = Number(parameter(params, 1));
    const states = rows.get('conversation_history_state') ?? [];
    const existing = states.find((row) => row['conversation_id'] === conversationId);
    if (existing) {
      const index = states.indexOf(existing);
      states.splice(index, 1, {...existing, revision});
    } else states.push({conversation_id: conversationId, revision});
    rows.set('conversation_history_state', states);
    return [];
  }
  if (/^UPDATE messages SET content = \$1 WHERE id = \$2$/i.test(normalized)) {
    const content = textParameter(params, 0);
    const messageId = textParameter(params, 1);
    const messages = rows.get('messages') ?? [];
    const message = messages.find((row) => row['id'] === messageId);
    if (message) messages.splice(messages.indexOf(message), 1, {...message, content});
    rows.set('messages', messages);
    return [];
  }
  if (/^UPDATE conversation_history_state/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const revision = Number(parameter(params, 1));
    const existing = rows.get('conversation_history_state') ?? [];
    const state = existing.find((row) => row['conversation_id'] === conversationId);
    if (state) existing.splice(existing.indexOf(state), 1, {...state, revision});
    rows.set('conversation_history_state', existing);
    return [];
  }
  if (/^UPDATE operation_receipts SET details/i.test(normalized)) {
    const operationId = textParameter(params, 0);
    const details = JSON.parse(textParameter(params, 1)) as unknown;
    const existing = rows.get('operation_receipts') ?? [];
    const receipt = existing.find((row) => row['operation_id'] === operationId);
    if (receipt) existing.splice(existing.indexOf(receipt), 1, {...receipt, details});
    rows.set('operation_receipts', existing);
    return [];
  }
  if (/^DELETE FROM session_checkpoints/i.test(normalized) && /RETURNING id/i.test(normalized)) {
    const conversationId = textParameter(params, 0);
    const retainCount = Number(parameter(params, 2));
    const checkpoints = (rows.get('session_checkpoints') ?? []).filter((row) => row['conversation_id'] === conversationId)
      .toSorted((left, right) => timestampMilliseconds(right['created_at']) - timestampMilliseconds(left['created_at']) || String(right['id']).localeCompare(String(left['id'])));
    const keep = new Set(checkpoints.slice(0, retainCount).map((row) => row['id']));
    const deleted = checkpoints.filter((row) => !keep.has(row['id']));
    rows.set('session_checkpoints', (rows.get('session_checkpoints') ?? []).filter((row) => row['conversation_id'] !== conversationId || keep.has(row['id'])));
    return deleted.map((row) => ({id: row['id']}));
  }
  if (/^\s*TRUNCATE\s+TABLE/i.test(normalized)) {
    const table = tableFromSql(normalized);
    if (table) rows.set(table, []);
    return [];
  }
  if (/^\s*DELETE\s+FROM/i.test(normalized)) {
    const table = tableFromSql(normalized);
    if (table) rows.set(table, []);
    return [];
  }
  const table = tableFromSql(normalized);
  return table ? (rows.get(table) ?? []).map((row) => ({...row})) : [];
}

export function createInMemoryPersistence(): TestPersistence {
  const rows = new Map<string, Array<Row>>();
  const failures: Array<FailureInjection> = [];
  const frames: Array<TransactionFrame> = [];
  const maybeFail = (operation: FailureInjection['operation']): Error | null => {
    const index = failures.findIndex((failure) => failure.operation === operation);
    if (index < 0) return null;
    const failure = failures.splice(index, 1)[0];
    return failure?.error ?? null;
  };
  async function query<T extends Record<string, unknown>>(sql: string, params: ReadonlyArray<unknown> = []): Promise<Array<T>> {
    const pending = failures.find((failure) => failure.operation === 'query'
      && (failure.when === undefined || (failure.when === 'inside_transaction') === (frames.length > 0))
      && (failure.sqlPattern === undefined || failure.sqlPattern.test(sql)));
    const error = pending ? failures.splice(failures.indexOf(pending), 1)[0]?.error ?? null : null;
    if (error) throw error;
    return applySql(activeRows(rows, frames), sql, params) as Array<T>;
  }
  function copyFrameTo(target: Map<string, Array<Row>>, source: ReadonlyMap<string, Array<Row>>): void {
    target.clear();
    for (const [table, tableRows] of source) target.set(table, tableRows);
  }
  function errorWithRoot(rootError: unknown, secondaryError: unknown): Error {
    const root = rootError instanceof Error ? rootError : new Error(String(rootError));
    const secondary = secondaryError instanceof Error ? secondaryError : new Error(String(secondaryError));
    return new AggregateError([root, secondary], `${root.message}; reconciliation failed: ${secondary.message}`);
  }
  async function runTransaction<T>(fn: (scope: TransactionScope) => Promise<T>): Promise<{readonly outcome: TransactionOutcome<T>; readonly publications: ReadonlyArray<() => void | Promise<void>>}> {
    const isOutermost = frames.length === 0;
    const frame: TransactionFrame = {rows: cloneRows(isOutermost ? rows : frames[frames.length - 1]!.rows), publications: []};
    frames.push(frame);
    const scope: TransactionScope = {
      query, depth: frames.length - 1, isOutermost, isProvisional: !isOutermost,
      registerAfterCommit: (publication) => { if (!isOutermost) throw new Error('nested transaction scope cannot publish or reconcile'); frame.publications.push(publication); },
    };
    try {
      const value = await fn(scope);
      if (!isOutermost) { frames.pop(); copyFrameTo(frames[frames.length - 1]!.rows, frame.rows); frames[frames.length - 1]!.publications.push(...frame.publications); return {outcome: {status: 'provisional', value}, publications: []}; }
      const commitFailure = failures.find((failure) => failure.operation === 'commit');
      if (commitFailure) {
        failures.splice(failures.indexOf(commitFailure), 1);
        frames.pop();
        if (commitFailure.commandTag === 'COMMIT') copyFrameTo(rows, frame.rows);
        // a lost commit acknowledgement keeps publications available for reconciliation.
        return commitFailure.commandTag === 'ROLLBACK'
          ? {outcome: {status: 'confirmed_rollback', error: commitFailure.error}, publications: []}
          : {outcome: {status: 'commit_unknown', error: commitFailure.error}, publications: [...frame.publications]};
      }
      frames.pop(); copyFrameTo(rows, frame.rows);
      return {outcome: {status: 'confirmed_commit', value}, publications: [...frame.publications]};
    } catch (error) {
      frames.pop();
      const rollbackError = maybeFail('rollback');
      if (rollbackError) return {outcome: {status: 'commit_unknown', error: errorWithRoot(error, rollbackError)}, publications: []};
      return {outcome: {status: 'confirmed_rollback', error}, publications: []};
    }
  }
  async function withTransactionOutcome<T>(fn: (scope: TransactionScope) => Promise<T>, reconcile?: (outcome: TransactionOutcome<T>, queryFn: QueryFunction) => Promise<void | TransactionReconciliation<T>>): Promise<TransactionOutcome<T>> {
    const initial = await runTransaction(fn);
    let outcome = initial.outcome;
    if (reconcile && (outcome.status === 'commit_unknown' || outcome.status === 'confirmed_commit')) {
      try {
        const result = await reconcile(outcome, query);
        if (result?.truth === 'committed' && outcome.status === 'commit_unknown') {
          if (result.value === undefined) return {status: 'commit_unknown', error: new Error('reconciliation confirmed commit without a durable value', {cause: outcome.error}), value: outcome.value};
          // Reconciled commits flow through the publication phase below like any
          // other confirmed truth; only non-commit outcomes return early.
          outcome = {status: 'reconciled_commit', value: result.value, error: outcome.error};
        } else if (result?.truth === 'rolled_back') { return outcome.status === 'confirmed_commit' ? {status: 'commit_unknown', error: new Error('post-commit reconciliation contradicted confirmed commit'), value: outcome.value} : {status: 'reconciled_rollback', error: result.error ?? outcome.error};
        } else if (result?.truth === 'unknown') { return {status: 'commit_unknown', error: outcome.status === 'commit_unknown' ? errorWithRoot(outcome.error, result.error) : result.error, value: outcome.value}; }
      } catch (error) { return {status: 'commit_unknown', error: outcome.status === 'commit_unknown' ? errorWithRoot(outcome.error, error) : error, value: outcome.value}; }
    }
    if (outcome.status === 'confirmed_commit' || outcome.status === 'reconciled_commit') {
      for (const [index, publication] of initial.publications.entries()) { try { const failure = maybeFail('publication'); if (failure) throw failure; await publication(); } catch (error) { const skipped = initial.publications.length - index - 1; return {status: 'committed_publication_failed', value: outcome.value, error, details: {attempted: index + 1, skipped}}; } }
    }
    return outcome;
  }
  async function withTransaction<T>(fn: (queryFn: QueryFunction) => Promise<T>): Promise<T> {
    const {outcome} = await runTransaction(async (scope) => fn(scope.query));
    if (outcome.status === 'confirmed_commit' || outcome.status === 'provisional') return outcome.value;
    throw outcome.error instanceof Error ? outcome.error : new Error(String(outcome.error));
  }
  return {connect: async () => undefined, disconnect: async () => undefined, runMigrations: async () => undefined, query, withTransaction, withTransactionOutcome, rows, failures};
}

export function successOutcome(output: string): ToolOutcome { return {kind: 'success', output}; }
