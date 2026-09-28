// pattern: Imperative Shell
import {randomUUID} from 'node:crypto';
import type {PersistenceProvider} from '@/persistence/types.ts';
import type {ConversationHistoryStore} from '@/persistence/conversation-history-store.ts';
import {AgentError} from '@/errors/agent.ts';
import {parseToolOutcome, type ToolOutcome} from '@/contracts/outcomes.ts';

export type UnresolvedToolCall = Readonly<{
  readonly callId: string;
  readonly outcome: 'cancelled' | 'outcome_unknown';
}>;

export type RecoveryState = Readonly<{
  readonly required: boolean;
  readonly reason: string | null;
  readonly batchId: string | null;
  readonly unresolvedCallIds: ReadonlyArray<string>;
}>;

export type RecoveryMarkerKind = 'restore' | 'compaction' | 'unresolved-effect';

export type IntegrityLifecycle = Readonly<{
  beginBatch(callIds: ReadonlyArray<string>): Promise<string>;
  recordOutcome(batchId: string, callId: string, outcome: ToolOutcome): Promise<void>;
  completeBatch(batchId: string): Promise<void>;
  /** Mark an incomplete batch as requiring trusted recovery when a write fails. An optional kind types the batch itself so generic recovery skips it. */
  markRecoveryRequired?: (batchId: string, reason: string, markerKind?: RecoveryMarkerKind) => Promise<void>;
  /**
   * Latch durable recovery-required state for a non-batch fault such as ambiguous
   * compaction, an in-progress restore, or an unresolved tool effect; returns the
   * marker id for later completion. Markers are never cleared by generic backfill.
   */
  markConversationRecoveryRequired?: (reason: string, markerKind?: RecoveryMarkerKind) => Promise<string>;
  /** Complete exactly one recovery marker once the faulting operation fully finished. */
  completeRecoveryMarker?: (batchId: string) => Promise<void>;
  /** Request and consume coalesced deferred compaction at a completed-batch boundary. */
  requestCompaction?: () => Promise<void>;
  consumeCompactionIntent?: () => Promise<boolean>;
  /** Durable count of successfully completed turns for interval continuity. */
  getCompletedTurnCount?: () => Promise<number>;
  recordCompletedTurn?: (turnNumber: number) => Promise<void>;
  getRecoveryState(): Promise<RecoveryState>;
  recover(callIds: ReadonlyArray<string>, reason?: string): Promise<void>;
}>;

type BatchDetails = {
  readonly batchId: string;
  readonly callIds: Array<string>;
  readonly outcomes: Record<string, ToolOutcome>;
  readonly completed: boolean;
  readonly recoveryRequired?: boolean;
  readonly reason?: string;
  /** Typed recovery marker; set batches are invisible to generic tool recovery. */
  readonly markerKind?: RecoveryMarkerKind;
};

function parseDetails(value: unknown): BatchDetails | null {
  if (typeof value !== 'object' || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row['batchId'] !== 'string' || !Array.isArray(row['callIds'])) return null;
  const callIds = row['callIds'].filter((value): value is string => typeof value === 'string');
  const outcomes: Record<string, ToolOutcome> = {};
  if (typeof row['outcomes'] === 'object' && row['outcomes'] !== null) {
    for (const [callId, outcome] of Object.entries(row['outcomes'])) {
      try {
        outcomes[callId] = parseToolOutcome(outcome);
      } catch {
        outcomes[callId] = {kind: 'outcome_unknown', code: 'invalid_persisted_outcome', message: 'persisted batch outcome was invalid'};
      }
    }
  }
  return {
    batchId: row['batchId'], callIds, outcomes,
    completed: row['completed'] === true,
    recoveryRequired: row['recoveryRequired'] === true,
    reason: typeof row['reason'] === 'string' ? row['reason'] : undefined,
    markerKind: row['markerKind'] === 'restore' || row['markerKind'] === 'compaction' || row['markerKind'] === 'unresolved-effect'
      ? row['markerKind']
      : undefined,
  };
}

/** Persistence-backed batch lifecycle. Rows are operation receipts, so no migration is required. */
export function createIntegrityLifecycle(
  persistence: PersistenceProvider,
  conversationId: string,
  historyStore?: ConversationHistoryStore,
): IntegrityLifecycle {
  const UNFINISHED_BATCH_PREDICATE = `((details->>'completed') IS DISTINCT FROM 'true' OR (details->>'recoveryRequired') = 'true')`;

  async function readBatchById(batchId: string): Promise<BatchDetails | null> {
    // Receipts are addressed by primary key: hot paths never re-read history.
    const rows = await persistence.query<{readonly operation_type: string; readonly details: unknown}>(
      'SELECT operation_id, operation_type, status, details FROM operation_receipts WHERE operation_id = $1',
      [batchId],
    );
    const row = rows[0];
    if (row === undefined || row.operation_type !== 'agent_batch') return null;
    return parseDetails(row.details);
  }

  async function readUnfinishedBatches(extraPredicate: string, extraParams: ReadonlyArray<unknown> = []): Promise<Array<BatchDetails>> {
    const rows = await persistence.query<{readonly details: unknown}>(
      `SELECT details FROM operation_receipts
        WHERE operation_type = 'agent_batch'
          AND details->>'conversationId' = $1
          AND ${extraPredicate}
          AND ${UNFINISHED_BATCH_PREDICATE}
        ORDER BY created_at ASC, operation_id ASC`,
      [conversationId, ...extraParams],
    );
    return rows.map((row) => parseDetails(row.details)).filter((batch): batch is BatchDetails => batch !== null);
  }

  async function writeBatch(batch: BatchDetails): Promise<void> {
    const details = JSON.stringify({...batch, conversationId});
    await persistence.query(
      `INSERT INTO operation_receipts (operation_id, operation_type, status, details)
       VALUES ($1, 'agent_batch', 'committed', $2::jsonb)
       ON CONFLICT (operation_id) DO UPDATE SET details = EXCLUDED.details, updated_at = NOW()`,
      [batch.batchId, details],
    );
  }

  async function beginBatch(callIds: ReadonlyArray<string>): Promise<string> {
    if (callIds.length === 0) {
      throw new AgentError('INTEGRITY_FAILED', 'cannot begin an empty tool batch', {conversationId});
    }
    const batch: BatchDetails = {batchId: randomUUID(), callIds: Array.from(new Set(callIds)), outcomes: {}, completed: false};
    await writeBatch(batch);
    return batch.batchId;
  }

  async function recordOutcome(batchId: string, callId: string, outcome: ToolOutcome): Promise<void> {
    const batch = await readBatchById(batchId);
    if (!batch || !batch.callIds.includes(callId)) {
      throw new AgentError('INTEGRITY_FAILED', `unknown agent batch call: ${callId}`, {
        conversationId,
        batchId,
        callId,
      });
    }
    await writeBatch({...batch, outcomes: {...batch.outcomes, [callId]: outcome}});
  }

  async function completeBatch(batchId: string): Promise<void> {
    const batch = await readBatchById(batchId);
    if (!batch) {
      throw new AgentError('INTEGRITY_FAILED', `unknown agent batch: ${batchId}`, {
        conversationId,
        batchId,
      });
    }
    if (batch.callIds.some((callId) => batch.outcomes[callId] === undefined)) {
      const unresolvedCallIds = batch.callIds.filter((callId) => batch.outcomes[callId] === undefined);
      throw new AgentError('INTEGRITY_FAILED', `cannot complete agent batch with unresolved calls: ${unresolvedCallIds.join(', ')}`, {
        conversationId,
        batchId,
        unresolvedCallIds,
      });
    }
    await writeBatch({...batch, completed: true});
  }

  async function getRecoveryState(): Promise<RecoveryState> {
    const unfinished = (await readUnfinishedBatches('TRUE'))[0];
    if (!unfinished) return {required: false, reason: null, batchId: null, unresolvedCallIds: []};
    return {
      required: true,
      reason: unfinished.reason ?? 'unfinished agent tool batch requires trusted recovery',
      batchId: unfinished.batchId,
      unresolvedCallIds: unfinished.callIds.filter((callId) => unfinished.outcomes[callId] === undefined),
    };
  }

  async function markRecoveryRequired(batchId: string, reason: string, markerKind?: RecoveryMarkerKind): Promise<void> {
    const batch = await readBatchById(batchId);
    if (!batch) {
      throw new AgentError('INTEGRITY_FAILED', `unknown agent batch: ${batchId}`, {
        conversationId,
        batchId,
      });
    }
    await writeBatch(markerKind
      ? {...batch, recoveryRequired: true, reason, markerKind}
      : {...batch, recoveryRequired: true, reason});
  }

  async function markConversationRecoveryRequired(reason: string, markerKind: RecoveryMarkerKind = 'compaction'): Promise<string> {
    // A synthetic empty batch keeps the recovery latch inside the existing receipt
    // schema: getRecoveryState treats any unfinished batch as recovery-required.
    // Typed markers are invisible to recover(), so generic tool backfill can never
    // clear a fault it does not actually reconcile.
    const priorMarkers = await readUnfinishedBatches(`(details->>'markerKind') = $2`, [markerKind]);
    const batch: BatchDetails = {
      batchId: `recovery-marker-${randomUUID()}`,
      callIds: [],
      outcomes: {},
      completed: false,
      recoveryRequired: true,
      reason,
      markerKind,
    };
    await writeBatch(batch);
    // Latch the new marker before retiring same-kind predecessors so recovery-required
    // never has an uncovered gap.
    for (const previous of priorMarkers) {
      await writeBatch({...previous, completed: true, recoveryRequired: false, reason: `superseded by marker ${batch.batchId}`});
    }
    return batch.batchId;
  }

  async function completeRecoveryMarker(batchId: string): Promise<void> {
    const marker = await readBatchById(batchId);
    if (!marker) {
      throw new AgentError('INTEGRITY_FAILED', `unknown recovery marker: ${batchId}`, {
        conversationId,
        batchId,
      });
    }
    await writeBatch({...marker, completed: true, recoveryRequired: false});
  }

  async function requestCompaction(): Promise<void> {
    await persistence.query(
      `INSERT INTO operation_receipts (operation_id, operation_type, status, details)
       SELECT $1, 'compaction_intent', 'committed', $2::jsonb
       WHERE NOT EXISTS (
         SELECT 1 FROM operation_receipts
          WHERE operation_type = 'compaction_intent'
            AND details->>'conversationId' = $3
            AND details->>'consumed' = 'false'
       )`,
      [randomUUID(), JSON.stringify({conversationId, consumed: false}), conversationId],
    );
  }

  async function consumeCompactionIntent(): Promise<boolean> {
    const rows = await persistence.query<{readonly operation_id: string}>(
      `SELECT operation_id FROM operation_receipts
        WHERE operation_type = 'compaction_intent'
          AND details->>'conversationId' = $1
          AND details->>'consumed' = 'false'
        ORDER BY created_at ASC LIMIT 1`, [conversationId],
    );
    const row = rows[0];
    if (!row) return false;
    await persistence.query(
      `UPDATE operation_receipts SET details = jsonb_set(details, '{consumed}', 'true'::jsonb), updated_at = NOW()
        WHERE operation_id = $1`, [row.operation_id],
    );
    return true;
  }

  async function getCompletedTurnCount(): Promise<number> {
    const rows = await persistence.query<{readonly operation_id: string; readonly details: unknown}>(
      'SELECT operation_id, operation_type, status, details FROM operation_receipts WHERE operation_id = $1',
      [`turn-counter-${conversationId}`],
    );
    const details = rows[0]?.details;
    if (typeof details !== 'object' || details === null) return 0;
    const value = (details as Record<string, unknown>)['completedTurnCount'];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
  }

  async function recordCompletedTurn(turnNumber: number): Promise<void> {
    if (!Number.isSafeInteger(turnNumber) || turnNumber < 0) {
      throw new AgentError('INTEGRITY_FAILED', 'completed turn number must be a non-negative safe integer', {
        conversationId,
        turnNumber,
      });
    }
    const current = await getCompletedTurnCount();
    if (turnNumber <= current) return;
    await persistence.query(
      `INSERT INTO operation_receipts (operation_id, operation_type, status, details)
       VALUES ($1, 'turn_counter', 'committed', $2::jsonb)
       ON CONFLICT (operation_id) DO UPDATE SET details = EXCLUDED.details, updated_at = NOW()`,
      [`turn-counter-${conversationId}`, JSON.stringify({conversationId, completedTurnCount: turnNumber})],
    );
  }

  async function repairOrphanedToolResults(reason: string): Promise<ReadonlyArray<string>> {
    if (!historyStore) return [];
    const active = await historyStore.readActive(conversationId);
    const resultIds = new Set(active.messages.filter((message) => message.role === 'tool' && message.tool_call_id).map((message) => message.tool_call_id as string));
    const missing = new Set<string>();
    for (const message of active.messages) {
      if (message.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
      for (const call of message.tool_calls) {
        if (typeof call !== 'object' || call === null || typeof (call as Record<string, unknown>)['id'] !== 'string') continue;
        const callId = (call as Record<string, unknown>)['id'] as string;
        if (!resultIds.has(callId)) missing.add(callId);
      }
    }
    for (const callId of missing) {
      await historyStore.append({
        conversation_id: conversationId,
        role: 'tool',
        content: reason,
        tool_call_id: callId,
        tool_calls: {outcome: {kind: 'outcome_unknown', code: 'trusted_backfill', message: reason}},
      });
    }
    return [...missing];
  }

  async function recover(callIds: ReadonlyArray<string>, reason = 'trusted maintenance backfill'): Promise<void> {
    // Typed recovery markers record faults generic tool backfill cannot reconcile
    // (half-applied restores, ambiguous history, unresolved effects); only their own
    // completion paths or a deliberately typed procedure may clear them.
    const unfinished = await readUnfinishedBatches(`(details->>'markerKind') IS NULL`);
    const repairedCallIds = await repairOrphanedToolResults(reason);
    if (unfinished.length === 0) return;
    const requested = new Set([...callIds, ...repairedCallIds]);
    for (const batch of unfinished) {
      const unresolved = batch.callIds.filter((callId) => batch.outcomes[callId] === undefined);
      if (unresolved.some((callId) => !requested.has(callId))) {
        throw new AgentError('INTEGRITY_FAILED', 'recovery must acknowledge every unresolved tool call', {
          conversationId,
          batchId: batch.batchId,
          unresolvedCallIds: unresolved,
          acknowledgedCallIds: Array.from(requested),
        });
      }
      const outcomes = {...batch.outcomes};
      for (const callId of unresolved) outcomes[callId] = {kind: 'outcome_unknown', code: 'trusted_backfill', message: reason};
      await writeBatch({...batch, outcomes, completed: true, recoveryRequired: false, reason});
    }
  }

  return {beginBatch, recordOutcome, completeBatch, markRecoveryRequired, markConversationRecoveryRequired, completeRecoveryMarker, requestCompaction, consumeCompactionIntent, getCompletedTurnCount, recordCompletedTurn, getRecoveryState, recover};
}
