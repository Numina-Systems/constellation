// pattern: Imperative Shell

import {randomUUID} from 'node:crypto';
import type {ConversationMessage} from '@/agent/types.ts';
import type {ModelProvider, ModelRequest, TextBlock} from '@/model/types.ts';
import {ModelError} from '@/model/types.ts';
import {buildRequestBudget} from '@/model/budget.ts';
import type {ConversationHistoryStore, PreparedCompactionPlan} from '@/persistence/conversation-history-store.ts';
import {deriveContinuation} from './continuation.ts';
import {groupConversationExchanges, projectExchangeGroup, selectCompactionGroups, type ExchangeGroup} from './grouping.ts';
import {buildResummarizationRequest, buildSummarizationRequest} from './prompt.ts';
import type {Breaker, BreakerClock} from './breaker.ts';
import type {CompactionConfig, CompactionPreparationOptions, CompactionResult, SummaryBatch} from './types.ts';
import {CompactionSummaryEmptyError, CompactionUnfittableError} from './types.ts';

export type DurableCompactorOptions = Readonly<{
  readonly model: ModelProvider;
  readonly historyStore: ConversationHistoryStore;
  readonly config: CompactionConfig;
  readonly modelName: string;
  readonly breaker: Breaker;
  readonly clock?: BreakerClock;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}>;

type PreparedUnit = Readonly<{
  readonly group: ExchangeGroup;
  readonly projected: ReturnType<typeof projectExchangeGroup>;
  readonly previousSummary: string | null;
}>;

type SummaryUnit = Readonly<{readonly batch: SummaryBatch; readonly projected: ReturnType<typeof projectExchangeGroup>}>;

function now(clock?: BreakerClock): number { return clock?.now() ?? Date.now(); }
function tokenEstimate(history: ReadonlyArray<ConversationMessage>): number { return Math.ceil(history.reduce((sum, message) => sum + message.content.length, 0) / 4); }
function textFromResponse(response: Readonly<{content: ReadonlyArray<unknown>}>): string {
  return response.content.filter((block): block is TextBlock => typeof block === 'object' && block !== null && 'type' in block && (block as {type?: unknown}).type === 'text' && 'text' in block && typeof (block as {text?: unknown}).text === 'string').map((block) => block.text).join('').trim();
}
function failure(history: ReadonlyArray<ConversationMessage>, code: CompactionResult['failureCode'], operationId: string | null = null, recoveryNote: string | null = null): CompactionResult {
  const before = tokenEstimate(history);
  return {history, batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: before, tokensEstimateAfter: before, failed: true, failureCode: code, operationId, recoveryNote};
}

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as {readonly code?: unknown}).code;
  return typeof code === 'string' ? code : null;
}

function priorSummaryContent(messages: ReadonlyArray<ConversationMessage>): string | null {
  const summary = messages.find((message) => message.role === 'system' && message.content.startsWith('[Context Summary'));
  return summary?.content ?? null;
}

function priorOperationId(messages: ReadonlyArray<ConversationMessage>): string | null {
  const summary = priorSummaryContent(messages);
  if (!summary) return null;
  const match = summary.match(/operationId:([^\s—]+)/);
  return match?.[1] ?? null;
}
function isTransient(error: unknown): boolean {
  return error instanceof ModelError && (error.retryable || error.code === 'TIMEOUT' || error.code === 'PROVIDER_UNAVAILABLE' || error.code === 'RATE_LIMITED');
}
function isIntervention(error: unknown): boolean {
  return error instanceof ModelError && !isTransient(error) && error.code !== 'CONTEXT_OVERFLOW' && error.code !== 'INVALID_RESPONSE';
}
function isCancelled(error: unknown): boolean {
  return error instanceof ModelError && error.code === 'CANCELLED';
}
function isDeadline(deadline: number, clock?: BreakerClock): boolean { return now(clock) >= deadline; }
function remaining(deadline: number, clock?: BreakerClock): number { return Math.max(1, deadline - now(clock)); }

async function waitBeforeRetry(options: DurableCompactorOptions, deadline: number, attempt: number): Promise<void> {
  const current = now(options.clock);
  const baseDelay = options.config.backoffBaseMs ?? 100;
  const delay = Math.min(baseDelay * Math.pow(2, attempt), Math.max(0, deadline - current));
  if (delay <= 0) throw new ModelError('TIMEOUT', 'compaction deadline exceeded during retry backoff', true);
  if (options.sleep) await options.sleep(delay);
  else await new Promise<void>((resolve) => setTimeout(resolve, delay));
  if (isDeadline(deadline, options.clock)) throw new ModelError('TIMEOUT', 'compaction deadline exceeded during retry backoff', true);
}

function archiveContent(batch: Readonly<SummaryUnit>, operationId: string): string {
  const source = batch.projected.messages.map((message) => ({id: message.id, role: message.role, content: message.content, toolCallId: message.tool_call_id ?? null, createdAt: message.created_at.toISOString()}));
  const metadata = {operationId, depth: batch.batch.depth, start: batch.batch.startTime.toISOString(), end: batch.batch.endTime.toISOString(), count: batch.batch.messageCount, sourceMessageIds: batch.batch.sourceMessageIds ?? [], provenance: source};
  return `${JSON.stringify(metadata)}\n${batch.batch.content}`;
}

function finalizeRequest(
  request: ModelRequest,
  options: DurableCompactorOptions,
  deadline: number,
  signal: AbortSignal | undefined,
): ModelRequest {
  const fit = buildRequestBudget({system: request.system, messages: request.messages, outputReserve: options.config.maxSummaryTokens, contextWindow: options.config.contextWindow ?? Number.MAX_SAFE_INTEGER, safetyMargin: options.config.safetyMargin});
  if (!fit.ok && options.config.contextWindow !== undefined) throw new CompactionUnfittableError(fit.message);
  return {...request, timeout: Math.min(options.config.timeout ?? remaining(deadline, options.clock), remaining(deadline, options.clock)), deadline, signal};
}

function makeRequest(
  unit: PreparedUnit,
  options: DurableCompactorOptions,
  deadline: number,
  signal: AbortSignal | undefined,
  continuation: string,
): ModelRequest {
  const request = buildSummarizationRequest({systemPrompt: options.config.prompt, previousSummary: unit.previousSummary, messages: unit.projected.messages, modelName: options.modelName, maxTokens: options.config.maxSummaryTokens});
  const withContinuation = continuation ? {...request, messages: [...request.messages.slice(0, -1), {role: 'user' as const, content: `Deterministic continuation:\n${continuation}`}, request.messages[request.messages.length - 1]!]} : request;
  return finalizeRequest(withContinuation, options, deadline, signal);
}

function makeRecursiveRequest(
  contents: ReadonlyArray<string>,
  options: DurableCompactorOptions,
  deadline: number,
  signal: AbortSignal | undefined,
  continuation: string,
): ModelRequest {
  const request = buildResummarizationRequest({systemPrompt: options.config.prompt, batchContents: contents, modelName: options.modelName, maxTokens: options.config.maxSummaryTokens});
  const withContinuation = continuation ? {...request, messages: [...request.messages.slice(0, -1), {role: 'user' as const, content: `Deterministic continuation:\n${continuation}`}, request.messages[request.messages.length - 1]!]} : request;
  return finalizeRequest(withContinuation, options, deadline, signal);
}

async function summarizeUnit(
  unit: PreparedUnit,
  options: DurableCompactorOptions,
  deadline: number,
  signal: AbortSignal | undefined,
  continuation: string,
): Promise<string> {
  const attempts = Math.max(0, options.config.maxRetries ?? 2) + 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isDeadline(deadline, options.clock)) throw new ModelError('TIMEOUT', 'compaction deadline exceeded', true);
    if (signal?.aborted) throw new ModelError('CANCELLED', 'compaction was cancelled', false);
    try {
      const request = makeRequest(unit, options, deadline, signal, continuation);
      const response = await options.model.complete(request);
      const summary = textFromResponse(response);
      if (!summary) throw new CompactionSummaryEmptyError();
      return summary;
    } catch (error) {
      lastError = error;
      if (error instanceof CompactionUnfittableError) throw error;
      if (isCancelled(error) || isIntervention(error)) throw error;
      if (!(isTransient(error) || error instanceof CompactionSummaryEmptyError)) throw error;
      if (attempt + 1 < attempts) {
        await waitBeforeRetry(options, deadline, attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('compaction summarization failed');
}

async function summarizeRecursive(
  contents: ReadonlyArray<string>,
  options: DurableCompactorOptions,
  deadline: number,
  signal: AbortSignal | undefined,
  continuation: string,
): Promise<string> {
  const attempts = Math.max(0, options.config.maxRetries ?? 2) + 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isDeadline(deadline, options.clock)) throw new ModelError('TIMEOUT', 'compaction deadline exceeded', true);
    if (signal?.aborted) throw new ModelError('CANCELLED', 'compaction was cancelled', false);
    try {
      const request = makeRecursiveRequest(contents, options, deadline, signal, continuation);
      const response = await options.model.complete(request);
      const summary = textFromResponse(response);
      if (!summary) throw new CompactionSummaryEmptyError();
      return summary;
    } catch (error) {
      lastError = error;
      if (error instanceof CompactionUnfittableError) throw error;
      if (isCancelled(error) || isIntervention(error)) throw error;
      if (!(isTransient(error) || error instanceof CompactionSummaryEmptyError)) throw error;
      if (attempt + 1 < attempts) {
        await waitBeforeRetry(options, deadline, attempt);
        continue;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error('recursive compaction summarization failed');
}

function batchFrom(group: Readonly<ExchangeGroup>, summary: string): SummaryBatch {
  return {content: summary, depth: 0, startTime: group.startTime, endTime: group.endTime, messageCount: group.messages.length, sourceMessageIds: group.messages.map((message) => message.id)};
}

/** Runs read/prepare → summarize → atomic commit for retained history. */
export async function runDurableCompaction(
  history: ReadonlyArray<ConversationMessage>,
  conversationId: string,
  options: DurableCompactorOptions,
  preparation: CompactionPreparationOptions | undefined,
): Promise<CompactionResult> {
  if (!options.breaker.allow()) return failure(history, 'breaker_open');
  const operationId = `compaction-${randomUUID()}`;
  const deadline = preparation?.request?.deadline ?? now(options.clock) + (options.config.timeout ?? 120_000);
  const signal = preparation?.request?.signal;
  try {
    const active = await options.historyStore.readActive(conversationId);
    if (active.revision < 0) throw new Error('invalid active history revision');
    const sourceMessages = await options.historyStore.enumerateCompactionSources(conversationId, Math.max(history.length, options.config.keepRecent + 1));
    const grouped = groupConversationExchanges(sourceMessages);
    if (grouped.error) return failure(history, 'history_stale_membership', operationId);
    const selected = selectCompactionGroups(grouped.groups, options.config.keepRecent);
    if (selected.source.length === 0) {
      options.breaker.recordSuccess();
      return {history, batchesCreated: 0, messagesCompressed: 0, tokensEstimateBefore: tokenEstimate(history), tokensEstimateAfter: tokenEstimate(history), operationId, revision: active.revision};
    }
    const continuation = deriveContinuation(history, options.config.continuationMaxChars ?? 2000);
    const previousSummary = priorSummaryContent(active.messages);
    const previousOperationId = priorOperationId(active.messages);
    const units: Array<PreparedUnit> = selected.source.map((group, index) => ({
      group,
      projected: projectExchangeGroup(group, group.messages.length),
      // Only the first unit receives the prior clip; later units remain bounded and independent.
      previousSummary: index === 0 ? previousSummary : null,
    }));
    const summarized: Array<SummaryUnit> = [];
    for (const unit of units) {
      const content = await summarizeUnit(unit, options, deadline, signal, continuation.text);
      summarized.push({batch: batchFrom(unit.group, content), projected: unit.projected});
    }
    if (isDeadline(deadline, options.clock) || signal?.aborted) return failure(history, signal?.aborted ? 'cancelled' : 'deadline_exceeded', operationId);
    const batches = summarized.map((unit) => unit.batch);
    let displayBatches: ReadonlyArray<SummaryBatch> = batches;
    const archiveUnits: Array<SummaryUnit> = [...summarized];
    if (batches.length > options.config.clipFirst + options.config.clipLast + 2) {
      const recursiveSources = batches.slice(0, batches.length - options.config.clipLast);
      const recursiveContent = await summarizeRecursive(recursiveSources.map((batch) => batch.content), options, deadline, signal, continuation.text);
      const first = recursiveSources[0];
      const last = recursiveSources[recursiveSources.length - 1];
      if (!first || !last) throw new Error('recursive compaction source disappeared');
      const recursiveBatch: SummaryBatch = {
        content: recursiveContent,
        depth: Math.max(...recursiveSources.map((batch) => batch.depth)) + 1,
        startTime: new Date(Math.min(...recursiveSources.map((batch) => batch.startTime.getTime()))),
        endTime: new Date(Math.max(...recursiveSources.map((batch) => batch.endTime.getTime()))),
        messageCount: recursiveSources.reduce((sum, batch) => sum + batch.messageCount, 0),
        sourceMessageIds: recursiveSources.flatMap((batch) => batch.sourceMessageIds ?? []),
      };
      displayBatches = [recursiveBatch, ...batches.slice(batches.length - options.config.clipLast)];
      archiveUnits.push({batch: recursiveBatch, projected: {messages: [], sourceMessageIds: recursiveBatch.sourceMessageIds ?? [], omitted: ['recursive source projections retained in initial archives']}});
    }
    const clipContent = `[Context Summary — operationId:${operationId} — ${selected.source.reduce((sum, group) => sum + group.messages.length, 0)} messages compressed across 1 compaction cycle]\n${displayBatches.map((batch) => `[Batch depth ${batch.depth} — ${batch.startTime.toISOString()} to ${batch.endTime.toISOString()}]\n${batch.content}`).join('\n\n')}${continuation.text ? `\n\n${continuation.text}` : ''}`;
    const archiveBlocks = archiveUnits.map((unit, index) => ({owner: conversationId, label: `compaction-batch-${conversationId}-${operationId}-${index}`, content: archiveContent(unit, operationId), tier: 'archival' as const}));
    const sourceIds = selected.source.flatMap((group) => group.messages.map((message) => message.id));
    const summary: PreparedCompactionPlan['summary'] = {id: `summary-${operationId}`, conversation_id: conversationId, role: 'system', content: clipContent, created_at: new Date()};
    const plan: PreparedCompactionPlan = {
      operationId,
      conversationId,
      expectedRevision: active.revision,
      sourceMessageIds: sourceIds,
      archiveBlocks,
      summary,
      supersedesOperationId: previousOperationId,
    };
    const committed = await options.historyStore.commitCompaction(plan);
    options.breaker.recordSuccess();
    return {history: committed.history.messages, batchesCreated: batches.length, messagesCompressed: sourceIds.length, tokensEstimateBefore: tokenEstimate(history), tokensEstimateAfter: tokenEstimate(committed.history.messages), operationId, archiveIds: committed.receipt.sourceArchiveIds, provenanceRefs: [committed.receipt.operationId], revision: committed.receipt.newRevision};
  } catch (error) {
    if (error instanceof CompactionUnfittableError) { options.breaker.recordFailure('unfittable'); return failure(history, 'unfittable', operationId); }
    if (error instanceof CompactionSummaryEmptyError) { options.breaker.recordFailure('transient'); return failure(history, 'summary_empty', operationId); }
    if (isCancelled(error)) { options.breaker.recordFailure('transient'); return failure(history, 'cancelled', operationId); }
    if (error instanceof ModelError && error.code === 'TIMEOUT') { options.breaker.recordFailure('transient'); return failure(history, 'deadline_exceeded', operationId); }
    const code = errorCode(error);
    if (code === 'history_stale_revision') { options.breaker.recordFailure('transient'); return failure(history, 'history_stale_revision', operationId); }
    if (code === 'history_stale_membership' || code === 'history_membership_mismatch') { options.breaker.recordFailure('intervention'); return failure(history, 'history_stale_membership', operationId); }
    if (code === 'history_state_unknown') {
      options.breaker.recordFailure('intervention');
      return failure(history, 'history_state_unknown', operationId, 'committed truth is unknown; reload trusted history before retrying');
    }
    if (code === 'committed_publication_failed') {
      options.breaker.recordSuccess();
      return failure(history, 'history_state_unknown', operationId, 'commit receipt established; reload trusted history before retrying publication');
    }
    options.breaker.recordFailure(isIntervention(error) ? 'intervention' : 'transient');
    return failure(history, 'intervention_required', operationId);
  }
}
