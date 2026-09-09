// pattern: Imperative Shell

import {randomUUID} from 'node:crypto';
import {toSql} from 'pgvector/utils';
import type {ConversationMessage} from '@/agent/types.ts';
import {parseToolOutcome, type ToolOutcome} from '@/contracts/outcomes.ts';
import type {TransactionOutcome} from '@/contracts/outcomes.ts';
import type {PersistenceProvider, QueryFunction} from './types.ts';

/** A message accepted into the retained transcript. */
export type HistoryMessageInput = Readonly<{
  readonly id?: string;
  readonly conversation_id: string;
  readonly role: ConversationMessage['role'];
  readonly content: string;
  readonly tool_calls?: unknown;
  readonly tool_call_id?: string | null;
  readonly reasoning_content?: string | null;
  readonly embedding?: ReadonlyArray<number> | null;
  readonly created_at?: Date;
}>;

export type ActiveHistory = Readonly<{
  readonly conversationId: string;
  readonly revision: number;
  readonly messages: ReadonlyArray<ConversationMessage>;
}>;

export type HistoricalMessage = Readonly<{
  readonly message: ConversationMessage;
  readonly status: 'historical' | 'superseded';
}>;

export type ArchiveBlockInput = Readonly<{
  readonly id?: string;
  readonly owner: string;
  readonly label: string;
  readonly content: string;
  readonly tier?: 'archival';
}>;

export type PreparedCompactionPlan = Readonly<{
  readonly operationId: string;
  readonly conversationId: string;
  readonly expectedRevision: number;
  readonly sourceMessageIds: ReadonlyArray<string>;
  readonly archiveBlocks: ReadonlyArray<ArchiveBlockInput>;
  readonly summary: HistoryMessageInput;
  readonly supersedesOperationId?: string | null;
}>;

/** Durable input for an exact historical checkpoint restore. */
export type PreparedExactRestorePlan = Readonly<{
  readonly operationId: string;
  readonly conversationId: string;
  /** Null is only valid for a first restore against revision zero. */
  readonly expectedRevision: number | null;
  readonly messageIds: ReadonlyArray<string>;
  readonly checkpointId: string;
  readonly sourceArchiveIds: ReadonlyArray<string>;
  readonly provenanceRefs: ReadonlyArray<string>;
}>;

export type HistoryReceipt = Readonly<{

  readonly operationId: string;
  readonly conversationId: string;
  readonly status: 'committed';
  readonly previousRevision: number;
  readonly newRevision: number;
  readonly sourceMessageIds: ReadonlyArray<string>;
  readonly sourceArchiveIds: ReadonlyArray<string>;
  readonly summaryMessageId: string;
}>;

export type ExactRestoreReceipt = Readonly<{
  readonly operationId: string;
  readonly conversationId: string;
  readonly status: 'committed';
  readonly previousRevision: number;
  readonly newRevision: number;
  readonly messageIds: ReadonlyArray<string>;
  readonly checkpointId: string;
  readonly sourceArchiveIds: ReadonlyArray<string>;
  readonly provenanceRefs: ReadonlyArray<string>;
}>;

export type HistoryStateUnknownError = Error & Readonly<{
  readonly code: 'history_state_unknown' | 'committed_publication_failed';
  readonly conversationId: string;
  readonly operationId: string;
}>;

export type ConversationHistoryStore = Readonly<{
  append(message: HistoryMessageInput): Promise<ConversationMessage>;
  readActive(conversationId: string): Promise<ActiveHistory>;
  readByIds(conversationId: string, messageIds: ReadonlyArray<string>): Promise<ReadonlyArray<ConversationMessage>>;
  readHistorical(conversationId: string, limit: number): Promise<ReadonlyArray<HistoricalMessage>>;
  enumerateCompactionSources(conversationId: string, limit: number): Promise<ReadonlyArray<ConversationMessage>>;
  commitCompaction(plan: PreparedCompactionPlan): Promise<Readonly<{receipt: HistoryReceipt; history: ActiveHistory}>>;
  restoreExactHistory(plan: PreparedExactRestorePlan): Promise<Readonly<{receipt: ExactRestoreReceipt; history: ActiveHistory}>>;
}>;

type MessageRow = {
  readonly id: string;
  readonly conversation_id: string;
  readonly role: string;
  readonly content: string;
  readonly tool_calls: unknown;
  readonly tool_call_id: string | null;
  readonly reasoning_content: string | null;
  readonly created_at: Date;
  readonly history_status?: 'historical' | 'superseded';
};

type StateRow = {readonly revision: string | number};
type ReceiptRow = {
  readonly operation_id: string;
  readonly conversation_id: string;
  readonly status: string;
  readonly details: Record<string, unknown>;
};

function parseMessage(row: MessageRow): ConversationMessage {
  const rawToolCalls = row.tool_calls ?? undefined;
  let toolCalls = rawToolCalls;
  let toolOutcome: ToolOutcome | undefined;
  if (row.role === 'tool') {
    if (typeof rawToolCalls === 'object' && rawToolCalls !== null && 'outcome' in rawToolCalls) {
      try {
        toolOutcome = parseToolOutcome((rawToolCalls as Record<string, unknown>)['outcome']);
      } catch {
        toolOutcome = {kind: 'outcome_unknown', code: 'invalid_persisted_outcome', message: 'persisted tool outcome was invalid'};
      }
    } else {
      toolOutcome = {kind: 'outcome_unknown', code: 'legacy_unknown', message: 'historical tool outcome status is unavailable'};
    }
    toolCalls = undefined;
  }
  return {
    id: row.id,
    conversation_id: row.conversation_id,
    role: row.role as ConversationMessage['role'],
    content: row.content,
    tool_calls: toolCalls,
    tool_call_id: row.tool_call_id ?? undefined,
    tool_outcome: toolOutcome,
    reasoning_content: row.reasoning_content,
    created_at: new Date(row.created_at),
  };
}

function requireIdentifier(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}

function historyUnknown(conversationId: string, operationId: string, cause: unknown, code: HistoryStateUnknownError['code'] = 'history_state_unknown'): HistoryStateUnknownError {
  const error = new Error(`history state unknown for conversation ${conversationId}; recovery is required`, {cause}) as HistoryStateUnknownError;
  Object.defineProperties(error, {
    code: {value: code, enumerable: true},
    conversationId: {value: conversationId, enumerable: true},
    operationId: {value: operationId, enumerable: true},
  });
  return error;
}

function outermostRequiredError(operation: 'exact history restore' | 'history compaction'): Error {
  const error = new Error(`${operation} must own the outermost transaction`);
  Object.defineProperty(error, 'code', {value: 'history_outermost_required', enumerable: true});
  return error;
}

function exactRestoreReceiptFromRow(row: ReceiptRow): ExactRestoreReceipt {
  const details = row.details;
  const readArray = (key: string): Array<string> => {
    const value = details[key];
    return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? [...value] : [];
  };
  const numberValue = (key: string): number => {
    const value = details[key];
    return typeof value === 'number' ? value : Number(value);
  };
  const conversationId = details['conversationId'];
  const checkpointId = details['checkpointId'];
  if (typeof conversationId !== 'string' || typeof checkpointId !== 'string') throw new Error('invalid exact restore receipt');
  return {
    operationId: row.operation_id,
    conversationId,
    status: 'committed',
    previousRevision: numberValue('previousRevision'),
    newRevision: numberValue('newRevision'),
    messageIds: readArray('messageIds'),
    checkpointId,
    sourceArchiveIds: readArray('sourceArchiveIds'),
    provenanceRefs: readArray('provenanceRefs'),
  };
}

function receiptFromRow(row: ReceiptRow): HistoryReceipt {
  const details = row.details;
  const readArray = (key: string): Array<string> => {
    const value = details[key];
    return Array.isArray(value) && value.every((item): item is string => typeof item === 'string') ? [...value] : [];
  };
  const numberValue = (key: string): number => {
    const value = details[key];
    return typeof value === 'number' ? value : Number(value);
  };
  const summaryMessageId = details['summaryMessageId'];
  const conversationId = row.conversation_id || details['conversationId'];
  if (typeof summaryMessageId !== 'string' || typeof conversationId !== 'string') throw new Error('invalid history receipt: missing summary message or conversation');
  return {
    operationId: row.operation_id,
    conversationId,
    status: 'committed',
    previousRevision: numberValue('previousRevision'),
    newRevision: numberValue('newRevision'),
    sourceMessageIds: readArray('sourceMessageIds'),
    sourceArchiveIds: readArray('sourceArchiveIds'),
    summaryMessageId,
  };
}

async function readActiveWithQuery(query: QueryFunction, conversationId: string): Promise<ActiveHistory> {
  await query(
    `INSERT INTO conversation_history_state (conversation_id, revision)
     VALUES ($1, 0)
     ON CONFLICT (conversation_id) DO NOTHING`, [conversationId],
  );
  const stateRows = await query<StateRow>(
    'SELECT revision FROM conversation_history_state WHERE conversation_id = $1 FOR SHARE',
    [conversationId],
  );
  const revision = stateRows.length === 0 ? 0 : Number(stateRows[0]?.revision ?? 0);
  const rows = await query<MessageRow>(
    `SELECT m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.tool_call_id,
            m.reasoning_content, m.created_at
       FROM conversation_history_membership h
       JOIN messages m ON m.conversation_id = h.conversation_id AND m.id = h.message_id
      WHERE h.conversation_id = $1
      ORDER BY h.position ASC`,
    [conversationId],
  );
  return {conversationId, revision, messages: rows.map(parseMessage)};
}

export function createConversationHistoryStore(persistence: PersistenceProvider): ConversationHistoryStore {
  async function append(message: HistoryMessageInput): Promise<ConversationMessage> {
    requireIdentifier(message.conversation_id, 'conversation_id');
    const id = message.id ?? randomUUID();
    const createdAt = message.created_at ?? new Date();
    return persistence.withTransaction(async (query) => {
      await query(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, message.conversation_id, message.role, message.content,
          message.tool_calls === undefined ? null : JSON.stringify(message.tool_calls),
          message.tool_call_id ?? null, message.reasoning_content ?? null,
          message.embedding === undefined || message.embedding === null ? null : toSql(message.embedding), createdAt],
      );
      const rows = await query<MessageRow>(
        `SELECT id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at
           FROM messages WHERE id = $1 AND conversation_id = $2`, [id, message.conversation_id],
      );
      if (rows.length !== 1 || rows[0] === undefined) throw new Error('failed to read appended message');
      return parseMessage(rows[0]);
    });
  }

  async function readActive(conversationId: string): Promise<ActiveHistory> {
    requireIdentifier(conversationId, 'conversation_id');
    return persistence.withTransaction((query) => readActiveWithQuery(query, conversationId));
  }

  async function readByIds(conversationId: string, messageIds: ReadonlyArray<string>): Promise<ReadonlyArray<ConversationMessage>> {
    requireIdentifier(conversationId, 'conversation_id');
    if (messageIds.length === 0) return [];
    const rows = await persistence.query<MessageRow & {readonly requested_position: number}>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.tool_call_id,
              m.reasoning_content, m.created_at, requested.requested_position
         FROM unnest($2::text[]) WITH ORDINALITY AS requested(message_id, requested_position)
         JOIN messages m ON m.id = requested.message_id AND m.conversation_id = $1
        ORDER BY requested.requested_position`, [conversationId, [...messageIds]],
    );
    if (rows.length !== messageIds.length) {
      const error = new Error(`history message membership mismatch for conversation ${conversationId}`);
      Object.defineProperty(error, 'code', {value: 'history_membership_mismatch', enumerable: true});
      throw error;
    }
    return rows.map(parseMessage);
  }

  async function readHistorical(conversationId: string, limit: number): Promise<ReadonlyArray<HistoricalMessage>> {
    requireIdentifier(conversationId, 'conversation_id');
    if (!Number.isInteger(limit) || limit < 1) throw new Error('historical read limit must be a positive integer');
    const rows = await persistence.query<MessageRow & {readonly history_status: 'historical' | 'superseded'}>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.tool_call_id,
              m.reasoning_content, m.created_at,
              CASE WHEN h.message_id IS NULL THEN 'superseded' ELSE 'historical' END AS history_status
         FROM messages m
         LEFT JOIN conversation_history_membership h
           ON h.conversation_id = m.conversation_id AND h.message_id = m.id
        WHERE m.conversation_id = $1
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $2`, [conversationId, limit],
    );
    return rows.map((row) => ({
      message: parseMessage(row),
      status: row.history_status,
    }));
  }

  async function enumerateCompactionSources(conversationId: string, limit: number): Promise<ReadonlyArray<ConversationMessage>> {
    requireIdentifier(conversationId, 'conversation_id');
    if (!Number.isInteger(limit) || limit < 1) throw new Error('compaction source limit must be a positive integer');
    let rows = await persistence.query<MessageRow>(
      `SELECT m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.tool_call_id,
              m.reasoning_content, m.created_at
         FROM conversation_history_membership h
         JOIN messages m ON m.conversation_id = h.conversation_id AND m.id = h.message_id
        WHERE h.conversation_id = $1
          AND NOT EXISTS (
            SELECT 1
              FROM conversation_history_provenance p
              JOIN operation_receipts r ON r.operation_id = p.operation_id
             WHERE p.conversation_id = h.conversation_id
               AND r.operation_type = 'compaction'
               AND m.id = ANY(p.source_message_ids)
          )
        ORDER BY h.position ASC
        LIMIT $2`, [conversationId, limit],
    );
    // Do not return a prefix ending on an assistant tool-call header. Extend the
    // read to include every correlated result so preparation cannot orphan an exchange.
    const last = rows[rows.length - 1];
    if (last && last.role === 'assistant' && Array.isArray(last.tool_calls)) {
      const callCount = last.tool_calls.filter((call) => typeof call === 'object' && call !== null).length;
      if (callCount > 0) {
        rows = await persistence.query<MessageRow>(
          `SELECT m.id, m.conversation_id, m.role, m.content, m.tool_calls, m.tool_call_id,
                  m.reasoning_content, m.created_at
             FROM conversation_history_membership h
             JOIN messages m ON m.conversation_id = h.conversation_id AND m.id = h.message_id
            WHERE h.conversation_id = $1
              AND NOT EXISTS (
                SELECT 1 FROM conversation_history_provenance p
                WHERE m.id = ANY(p.source_message_ids)
              )
            ORDER BY h.position ASC
            LIMIT $2`, [conversationId, limit + callCount],
        );
      }
    }
    return rows.map(parseMessage);
  }

  async function reconcileCompaction(
    plan: PreparedCompactionPlan,
    _outcome: TransactionOutcome<HistoryReceipt>,
    query: QueryFunction,
  ): Promise<{truth: 'committed'; value: HistoryReceipt} | {truth: 'rolled_back'} | {truth: 'unknown'; error: unknown}> {
    try {
      const rows = await query<ReceiptRow>(
        `SELECT operation_id, conversation_id, status, details
           FROM operation_receipts WHERE operation_id = $1`, [plan.operationId],
      );
      if (rows.length > 0 && rows[0]?.status === 'committed') return {truth: 'committed', value: receiptFromRow(rows[0])};
      if (rows.length === 0) return {truth: 'unknown', error: new Error(`receipt ${plan.operationId} is absent; commit truth is unknown`)};
      return {truth: 'unknown', error: new Error(`receipt ${plan.operationId} is not committed`)};
    } catch (error) {
      return {truth: 'unknown', error};
    }
  }

  async function restoreExactHistory(plan: PreparedExactRestorePlan): Promise<Readonly<{receipt: ExactRestoreReceipt; history: ActiveHistory}>> {
    requireIdentifier(plan.operationId, 'operation_id');
    requireIdentifier(plan.conversationId, 'conversation_id');
    requireIdentifier(plan.checkpointId, 'checkpoint_id');
    if (plan.messageIds.length === 0) throw new Error('exact restore requires active message IDs');
    if (new Set(plan.messageIds).size !== plan.messageIds.length) throw new Error('exact restore message IDs must be unique');
    const transaction = persistence.withTransactionOutcome;
    if (!transaction) throw new Error('exact history restore requires transaction outcome support');
    const reconcile = async (_outcome: TransactionOutcome<ExactRestoreReceipt>, query: QueryFunction): Promise<{truth: 'committed'; value: ExactRestoreReceipt} | {truth: 'rolled_back'} | {truth: 'unknown'; error: unknown}> => {
      try {
        const rows = await query<ReceiptRow>('SELECT operation_id, conversation_id, status, details FROM operation_receipts WHERE operation_id = $1', [plan.operationId]);
        if (rows.length > 0 && rows[0]?.status === 'committed') return {truth: 'committed', value: exactRestoreReceiptFromRow(rows[0])};
        if (rows.length === 0) return {truth: 'unknown', error: new Error(`receipt ${plan.operationId} is absent; commit truth is unknown`)};
        return {truth: 'unknown', error: new Error(`receipt ${plan.operationId} is not committed`)};
      } catch (error) {
        return {truth: 'unknown', error};
      }
    };
    const outcome = await transaction(async (scope) => {
      if (!scope.isOutermost || scope.isProvisional) throw outermostRequiredError('exact history restore');
      await scope.query(
        `INSERT INTO conversation_history_state (conversation_id, revision) VALUES ($1, 0) ON CONFLICT (conversation_id) DO NOTHING`,
        [plan.conversationId],
      );
      const stateRows = await scope.query<StateRow>('SELECT revision FROM conversation_history_state WHERE conversation_id = $1 FOR UPDATE', [plan.conversationId]);
      const currentRevision = Number(stateRows[0]?.revision ?? 0);
      const existing = await scope.query<ReceiptRow>('SELECT operation_id, conversation_id, status, details FROM operation_receipts WHERE operation_id = $1 FOR UPDATE', [plan.operationId]);
      if (existing.length > 0) {
        if (existing[0]?.status !== 'committed') throw new Error(`operation ${plan.operationId} has non-committed receipt`);
        return exactRestoreReceiptFromRow(existing[0]);
      }
      if (plan.expectedRevision !== null && currentRevision !== plan.expectedRevision) {
        const error = new Error(`stale exact restore revision: expected ${plan.expectedRevision}, found ${currentRevision}`);
        Object.defineProperty(error, 'code', {value: 'history_stale_revision', enumerable: true});
        throw error;
      }
      if (plan.expectedRevision === null && currentRevision !== 0) throw new Error(`first exact restore requires revision zero, found ${currentRevision}`);
      const retainedRows = await scope.query<{readonly id: string; readonly conversation_id: string}>(
        'SELECT id, conversation_id FROM messages WHERE id = ANY($2::text[]) AND conversation_id = $1',
        [plan.conversationId, [...plan.messageIds]],
      );
      if (retainedRows.length !== plan.messageIds.length) {
        const error = new Error(`exact restore retained message mismatch for conversation ${plan.conversationId}`);
        Object.defineProperty(error, 'code', {value: 'history_membership_mismatch', enumerable: true});
        throw error;
      }
      const newRevision = currentRevision + 1;
      await scope.query('DELETE FROM conversation_history_membership WHERE conversation_id = $1', [plan.conversationId]);
      for (const [position, messageId] of plan.messageIds.entries()) {
        await scope.query(
          'INSERT INTO conversation_history_membership (conversation_id, message_id, position) VALUES ($1, $2, $3)',
          [plan.conversationId, messageId, position],
        );
      }
      await scope.query('UPDATE conversation_history_state SET revision = $2, updated_at = NOW() WHERE conversation_id = $1', [plan.conversationId, newRevision]);
      const details = {conversationId: plan.conversationId, checkpointId: plan.checkpointId, previousRevision: currentRevision, newRevision, messageIds: [...plan.messageIds], sourceArchiveIds: [...plan.sourceArchiveIds], provenanceRefs: [...plan.provenanceRefs], summaryMessageId: plan.messageIds[plan.messageIds.length - 1]};
      await scope.query(`INSERT INTO operation_receipts (operation_id, operation_type, status, details) VALUES ($1, 'checkpoint_restore', 'committed', $2::jsonb)`, [plan.operationId, JSON.stringify(details)]);
      await scope.query(
        `INSERT INTO conversation_history_provenance (operation_id, conversation_id, source_message_ids, source_archive_ids, previous_revision, new_revision, summary_message_id, supersedes_operation_id) VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [plan.operationId, plan.conversationId, [...plan.messageIds], [...plan.sourceArchiveIds], currentRevision, newRevision, plan.messageIds[plan.messageIds.length - 1]],
      );
      for (const archiveId of plan.sourceArchiveIds) {
        await scope.query('INSERT INTO conversation_history_archive_refs (operation_id, archive_block_id) VALUES ($1, $2)', [plan.operationId, archiveId]);
      }
      return {operationId: plan.operationId, conversationId: plan.conversationId, status: 'committed' as const, previousRevision: currentRevision, newRevision, messageIds: [...plan.messageIds], checkpointId: plan.checkpointId, sourceArchiveIds: [...plan.sourceArchiveIds], provenanceRefs: [...plan.provenanceRefs]};
    }, reconcile);
    if (outcome.status === 'confirmed_rollback' || outcome.status === 'reconciled_rollback') throw outcome.error;
    if (outcome.status === 'commit_unknown' || outcome.status === 'committed_publication_failed') throw historyUnknown(plan.conversationId, plan.operationId, outcome.error);
    const receipt = outcome.value;
    return {receipt, history: await readActive(plan.conversationId)};
  }

  async function commitCompaction(plan: PreparedCompactionPlan): Promise<Readonly<{receipt: HistoryReceipt; history: ActiveHistory}>> {
    requireIdentifier(plan.operationId, 'operation_id');
    requireIdentifier(plan.conversationId, 'conversation_id');
    if (!Number.isInteger(plan.expectedRevision) || plan.expectedRevision < 0) throw new Error('expected_revision must be a non-negative integer');
    if (plan.sourceMessageIds.length === 0) throw new Error('compaction requires source messages');
    if (plan.summary.conversation_id !== plan.conversationId) throw new Error('summary conversation does not match compaction conversation');
    const transaction = persistence.withTransactionOutcome;
    if (!transaction) throw new Error('history compaction requires transaction outcome support');
    const outcome = await transaction(async (scope) => {
      if (!scope.isOutermost || scope.isProvisional) throw outermostRequiredError('history compaction');
      const stateRows = await scope.query<StateRow>(
        'SELECT revision FROM conversation_history_state WHERE conversation_id = $1 FOR UPDATE', [plan.conversationId],
      );
      const currentRevision = Number(stateRows[0]?.revision ?? 0);
      // Idempotent retries reconcile by operation identity before stale-plan checks.
      const existing = await scope.query<ReceiptRow>(
        'SELECT operation_id, conversation_id, status, details FROM operation_receipts WHERE operation_id = $1 FOR UPDATE', [plan.operationId],
      );
      if (existing.length > 0) {
        if (existing[0]?.status !== 'committed') throw new Error(`operation ${plan.operationId} has non-committed receipt`);
        return receiptFromRow(existing[0]);
      }
      if (currentRevision !== plan.expectedRevision) {
        const error = new Error(`stale compaction revision: expected ${plan.expectedRevision}, found ${currentRevision}`);
        Object.defineProperty(error, 'code', {value: 'history_stale_revision', enumerable: true});
        throw error;
      }
      const membershipRows = await scope.query<{readonly message_id: string}>(
        `SELECT message_id FROM conversation_history_membership WHERE conversation_id = $1 ORDER BY position`, [plan.conversationId],
      );
      const activeIds = membershipRows.map((row) => row.message_id);
      if (plan.sourceMessageIds.some((id) => !activeIds.includes(id))) {
        const error = new Error('stale compaction source membership');
        Object.defineProperty(error, 'code', {value: 'history_stale_membership', enumerable: true});
        throw error;
      }
      await scope.query(
        `INSERT INTO operation_receipts (operation_id, operation_type, status, details)
         VALUES ($1, 'compaction', 'committed', '{}'::jsonb)`, [plan.operationId],
      );
      const archiveIds: Array<string> = [];
      for (const archive of plan.archiveBlocks) {
        const archiveId = archive.id ?? randomUUID();
        archiveIds.push(archiveId);
        await scope.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, permission, pinned, history_owned, history_owner_operation_id)
           VALUES ($1, $2, 'archival', $3, $4, 'readonly', TRUE, TRUE, $5)`,
          [archiveId, archive.owner, archive.label, archive.content, plan.operationId],
        );
      }
      const summaryId = plan.summary.id ?? randomUUID();
      await scope.query(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8)`,
        [summaryId, plan.conversationId, plan.summary.role, plan.summary.content,
          plan.summary.tool_calls === undefined ? null : JSON.stringify(plan.summary.tool_calls),
          plan.summary.tool_call_id ?? null, plan.summary.reasoning_content ?? null, plan.summary.created_at ?? new Date()],
      );
      await scope.query(
        'DELETE FROM conversation_history_membership WHERE conversation_id = $1 AND message_id = ANY($2::text[])',
        [plan.conversationId, [...plan.sourceMessageIds]],
      );
      // The migration trigger adds every inserted message to the active projection.
      // Source removal below leaves the summary at the end of the retained order.
      const newRevision = currentRevision + 1;
      await scope.query(
        `UPDATE conversation_history_state SET revision = $2, updated_at = NOW() WHERE conversation_id = $1`,
        [plan.conversationId, newRevision],
      );
      const details = {conversationId: plan.conversationId, previousRevision: currentRevision, newRevision,
        sourceMessageIds: [...plan.sourceMessageIds], sourceArchiveIds: archiveIds, summaryMessageId: summaryId};
      await scope.query(
        `UPDATE operation_receipts SET details = $2::jsonb, updated_at = NOW()
         WHERE operation_id = $1`, [plan.operationId, JSON.stringify(details)],
      );
      await scope.query(
        `INSERT INTO conversation_history_provenance
          (operation_id, conversation_id, source_message_ids, source_archive_ids, previous_revision, new_revision,
           summary_message_id, supersedes_operation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [plan.operationId, plan.conversationId, [...plan.sourceMessageIds], archiveIds, currentRevision, newRevision, summaryId, plan.supersedesOperationId ?? null],
      );
      for (const archiveId of archiveIds) {
        await scope.query(
          'INSERT INTO conversation_history_archive_refs (operation_id, archive_block_id) VALUES ($1, $2)', [plan.operationId, archiveId],
        );
      }
      return {
        operationId: plan.operationId, conversationId: plan.conversationId, status: 'committed' as const,
        previousRevision: currentRevision, newRevision, sourceMessageIds: [...plan.sourceMessageIds],
        sourceArchiveIds: archiveIds, summaryMessageId: summaryId,
      };
    }, async (unknown, query) => reconcileCompaction(plan, unknown, query));

    if (outcome.status === 'confirmed_rollback' || outcome.status === 'reconciled_rollback') throw outcome.error;
    if (outcome.status === 'commit_unknown') throw historyUnknown(plan.conversationId, plan.operationId, outcome.error);
    if (outcome.status === 'committed_publication_failed') throw historyUnknown(plan.conversationId, plan.operationId, outcome.error, 'committed_publication_failed');
    const receipt = outcome.value;
    return {receipt, history: await readActive(plan.conversationId)};
  }

  return {append, readActive, readByIds, readHistorical, enumerateCompactionSources, commitCompaction, restoreExactHistory};
}
