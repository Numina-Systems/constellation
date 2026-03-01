// pattern: Imperative Shell

/**
 * Core compaction pipeline implementation.
 * Orchestrates: split, chunk, summarize, archive, delete old messages, and build clip-archive.
 * Dependencies: ModelProvider (LLM summarization), MemoryManager (archival writes),
 * PersistenceProvider (message deletion), CompactionConfig (tuning parameters).
 */

import { randomUUID } from 'crypto';
import type { ConversationMessage } from '../agent/types.js';
import type { ModelProvider, TextBlock } from '../model/types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PersistenceProvider } from '../persistence/types.js';
import type {
  SummaryBatch,
  CompactionResult,
  CompactionConfig,
  Compactor,
} from './types.js';
import {
  buildSummarizationRequest,
  buildResummarizationRequest,
} from './prompt.js';

export type CreateCompactorOptions = {
  readonly model: ModelProvider;
  readonly memory: MemoryManager;
  readonly persistence: PersistenceProvider;
  readonly config: CompactionConfig;
  readonly modelName: string;
};

/**
 * Split history into two parts: messages to compress and messages to keep.
 * If the first message is a prior compaction summary (role='system' and content starts with '[Context Summary —'),
 * extract it separately to avoid re-summarizing it.
 */
export function splitHistory(
  history: ReadonlyArray<ConversationMessage>,
  keepRecent: number,
): {
  toCompress: ReadonlyArray<ConversationMessage>;
  toKeep: ReadonlyArray<ConversationMessage>;
  priorSummary: ConversationMessage | null;
} {
  if (history.length === 0) {
    return {
      toCompress: [],
      toKeep: [],
      priorSummary: null,
    };
  }

  let priorSummary: ConversationMessage | null = null;
  let compressStartIndex = 0;

  // Check if the first message is a prior compaction summary
  const firstMessage = history[0];
  if (
    firstMessage &&
    firstMessage.role === 'system' &&
    firstMessage.content.startsWith('[Context Summary —')
  ) {
    priorSummary = firstMessage;
    compressStartIndex = 1;
  }

  // Split into toCompress and toKeep based on keepRecent
  const compressableCount = history.length - compressStartIndex;
  const toKeepCount = Math.min(keepRecent, compressableCount);
  const splitIndex = compressStartIndex + compressableCount - toKeepCount;

  return {
    toCompress: history.slice(compressStartIndex, splitIndex),
    toKeep: history.slice(splitIndex),
    priorSummary,
  };
}

/**
 * Batch metadata structure extracted from archived content headers.
 * Format in content: [depth:N|start:ISO|end:ISO|count:M]\n{actual content}
 */
export type BatchMetadata = {
  readonly depth: number;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly messageCount: number;
};

/**
 * Parse batch metadata header from archived batch content.
 * If no metadata header found, returns defaults (depth 0, current time, count 0).
 * Handles malformed metadata gracefully.
 */
export function parseBatchMetadata(content: string): {
  readonly metadata: BatchMetadata;
  readonly cleanContent: string;
} {
  const metadataRegex = /^\[depth:(\d+)\|start:([^\|]+)\|end:([^\|]+)\|count:(\d+)\]\n(.*)$/s;
  const match = content.match(metadataRegex);

  if (!match) {
    // No metadata header found, return defaults
    const now = new Date();
    return {
      metadata: {
        depth: 0,
        startTime: now,
        endTime: now,
        messageCount: 0,
      },
      cleanContent: content,
    };
  }

  const [, depthStr, startStr, endStr, countStr, cleanContent] = match;
  const depth = parseInt(depthStr ?? '0', 10) || 0;
  const messageCount = parseInt(countStr ?? '0', 10) || 0;

  let startTime: Date;
  let endTime: Date;

  try {
    startTime = new Date(startStr ?? '');
    endTime = new Date(endStr ?? '');

    // Validate dates are valid
    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      throw new Error('Invalid date in metadata');
    }
  } catch {
    // If dates fail to parse, use current time
    const now = new Date();
    startTime = now;
    endTime = now;
  }

  return {
    metadata: {
      depth,
      startTime,
      endTime,
      messageCount,
    },
    cleanContent: cleanContent ?? '',
  };
}

/**
 * Break an array of messages into chunks of a given size.
 * Last chunk may be smaller.
 */
export function chunkMessages(
  messages: ReadonlyArray<ConversationMessage>,
  chunkSize: number,
): ReadonlyArray<ReadonlyArray<ConversationMessage>> {
  if (messages.length === 0) {
    return [];
  }

  const chunks: Array<ReadonlyArray<ConversationMessage>> = [];
  for (let i = 0; i < messages.length; i += chunkSize) {
    chunks.push(messages.slice(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Estimate tokens using the heuristic: 1 token ≈ 4 characters.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Build the clip-archive string content.
 * Shows first clipFirst and last clipLast batches; omits the middle with a separator if needed.
 */
export function buildClipArchive(
  batches: ReadonlyArray<SummaryBatch>,
  config: CompactionConfig,
  totalMessagesCompressed: number,
): string {
  if (batches.length === 0) {
    return '[Context Summary — 0 messages compressed]';
  }

  const { clipFirst, clipLast } = config;
  const lines: Array<string> = [];

  // Header
  const cycleCount = batches.length > 0 ? Math.max(...batches.map(b => b.depth)) + 1 : 0;
  lines.push(
    `[Context Summary — ${totalMessagesCompressed} messages compressed across ${cycleCount} compaction cycle${cycleCount === 1 ? '' : 's'}]`
  );

  // Determine which batches to show
  const totalBatches = batches.length;
  let earliestBatches: ReadonlyArray<SummaryBatch>;
  let recentBatches: ReadonlyArray<SummaryBatch>;
  let hasOmission = false;

  if (totalBatches <= clipFirst + clipLast) {
    // Show all batches without section headers
    earliestBatches = batches;
    recentBatches = [];
  } else {
    // Show first clipFirst, then omission, then last clipLast
    earliestBatches = batches.slice(0, clipFirst);
    recentBatches = batches.slice(totalBatches - clipLast);
    hasOmission = true;
  }

  // Earliest context section (only show header if there will be an omission)
  if (earliestBatches.length > 0) {
    if (hasOmission) {
      lines.push('## Earliest context');
    }
    for (let i = 0; i < earliestBatches.length; i++) {
      const batch = earliestBatches[i];
      if (batch) {
        lines.push(
          `[Batch ${i + 1} — depth ${batch.depth}, ${batch.startTime.toISOString()} to ${batch.endTime.toISOString()}]`
        );
        lines.push(batch.content);
        lines.push('');
      }
    }
  }

  // Omission separator (only if there are omitted batches)
  if (hasOmission) {
    const omittedCount = totalBatches - clipFirst - clipLast;
    lines.push(
      `[... ${omittedCount} earlier summaries omitted, searchable via memory_read ...]`
    );
    lines.push('');
  }

  // Recent context section (only show header if there will be an omission)
  if (recentBatches.length > 0) {
    if (hasOmission) {
      lines.push('## Recent context');
    }
    for (let i = 0; i < recentBatches.length; i++) {
      const batch = recentBatches[i];
      if (batch) {
        const actualBatchNumber = totalBatches - recentBatches.length + i + 1;
        lines.push(
          `[Batch ${actualBatchNumber} — depth ${batch.depth}, ${batch.startTime.toISOString()} to ${batch.endTime.toISOString()}]`
        );
        lines.push(batch.content);
        lines.push('');
      }
    }
  }

  return lines.join('\n').trim();
}

/**
 * List existing compaction batches for a conversation.
 * Returns blocks in chronological order (oldest first).
 * Used in Phase 4 Task 3 for recursive re-summarization.
 */
export async function getCompactionBatches(
  memory: MemoryManager,
  conversationId: string,
): Promise<Array<{ id: string; batch: SummaryBatch }>> {
  const allArchival = await memory.list('archival');

  // Filter to only compaction batch blocks for this conversation
  // Append trailing dash to prevent prefix collision (e.g., "test" matching "test-123")
  const labelPrefix = `compaction-batch-${conversationId}-`;
  const batchBlocks = allArchival.filter((block) =>
    block.label.startsWith(labelPrefix),
  );

  // Parse each block to extract SummaryBatch metadata
  const batches = batchBlocks
    .map((block) => {
      const { metadata, cleanContent } = parseBatchMetadata(block.content);
      const batch: SummaryBatch = {
        content: cleanContent,
        depth: metadata.depth,
        startTime: metadata.startTime,
        endTime: metadata.endTime,
        messageCount: metadata.messageCount,
      };
      return { id: block.id, batch };
    })
    .sort((a, b) => a.batch.startTime.getTime() - b.batch.startTime.getTime());

  return batches;
}

/**
 * Determine if accumulated summary batches should be re-summarized.
 * Re-summarization triggers when total batch count exceeds the clip window
 * plus a small buffer to allow natural accumulation.
 * Pure function.
 */
export function shouldResummarize(
  batchCount: number,
  config: CompactionConfig,
): boolean {
  const buffer = 2;
  const threshold = config.clipFirst + config.clipLast + buffer;
  return batchCount > threshold;
}

/**
 * Options for re-summarizing accumulated batches.
 */
export type ResummarizeBatchesOptions = {
  readonly batches: ReadonlyArray<{ id: string; batch: SummaryBatch }>;
  readonly conversationId: string;
  readonly memory: MemoryManager;
  readonly model: ModelProvider;
  readonly modelName: string;
  readonly config: CompactionConfig;
  readonly systemPrompt: string | null;
};

/**
 * Re-summarize accumulated batches into a single higher-depth batch.
 * Selects batches that would be omitted by clip-archive (outside the clip window),
 * groups them, re-summarizes, and replaces them with a single depth+1 batch.
 * Async function with side effects (memory writes/deletes, LLM calls).
 */
export async function resummarizeBatches(options: ResummarizeBatchesOptions): Promise<void> {
  const { batches, conversationId, memory, model, modelName, config, systemPrompt } = options;
  if (batches.length <= config.clipFirst + config.clipLast) {
    // Not enough batches to trigger re-summarization
    return;
  }

  // Select batches to re-summarize: all except the last clipLast
  const batchesToResummarize = batches.slice(0, batches.length - config.clipLast);

  if (batchesToResummarize.length === 0) {
    return;
  }

  // Calculate new batch metadata
  const firstBatch = batchesToResummarize[0]?.batch;
  const lastBatch = batchesToResummarize[batchesToResummarize.length - 1]?.batch;
  if (!firstBatch || !lastBatch) {
    return;
  }

  const maxDepth = Math.max(...batchesToResummarize.map((b) => b.batch.depth));
  const newDepth = maxDepth + 1;
  const totalMessageCount = batchesToResummarize.reduce(
    (sum, b) => sum + b.batch.messageCount,
    0,
  );

  // Call summarization model to produce a condensed summary
  const batchContents = batchesToResummarize.map((b) => b.batch.content);

  const request = buildResummarizationRequest({
    systemPrompt,
    batchContents,
    modelName,
    maxTokens: config.maxSummaryTokens,
  });

  const response = await model.complete(request);
  const resummarizedContent = response.content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

  // Create new batch with incremented depth
  const newBatch: SummaryBatch = {
    content: resummarizedContent,
    depth: newDepth,
    startTime: firstBatch.startTime,
    endTime: lastBatch.endTime,
    messageCount: totalMessageCount,
  };

  // Delete the source batches from memory FIRST to avoid label collision
  // (if the last source batch has the same endTime as newBatch, deletion must happen before write)
  for (const { id } of batchesToResummarize) {
    await memory.deleteBlock(id);
  }

  // Archive the new batch
  const label = `compaction-batch-${conversationId}-${newBatch.endTime.toISOString()}`;
  const metadataHeader = `[depth:${newBatch.depth}|start:${newBatch.startTime.toISOString()}|end:${newBatch.endTime.toISOString()}|count:${newBatch.messageCount}]`;
  const contentWithMetadata = `${metadataHeader}\n${newBatch.content}`;

  await memory.write(
    label,
    contentWithMetadata,
    'archival',
    'Re-summarized during context compaction',
  );
}

export function createCompactor(
  options: CreateCompactorOptions,
): Compactor {
  const { model, memory, persistence, config, modelName } = options;

  async function summarizeChunk(
    chunk: ReadonlyArray<ConversationMessage>,
    existingSummary: string,
    systemPrompt: string | null,
  ): Promise<string> {
    const request = buildSummarizationRequest({
      systemPrompt,
      previousSummary: existingSummary || null,
      messages: chunk,
      modelName,
      maxTokens: config.maxSummaryTokens,
    });

    const response = await model.complete(request);
    const summary = response.content
      .filter((b): b is TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return summary;
  }

  async function archiveBatch(
    batch: SummaryBatch,
    conversationId: string,
  ): Promise<void> {
    const label = `compaction-batch-${conversationId}-${batch.endTime.toISOString()}`;

    // Prepend metadata header to batch content
    const metadataHeader = `[depth:${batch.depth}|start:${batch.startTime.toISOString()}|end:${batch.endTime.toISOString()}|count:${batch.messageCount}]`;
    const contentWithMetadata = `${metadataHeader}\n${batch.content}`;

    await memory.write(
      label,
      contentWithMetadata,
      'archival',
      'Archived during context compaction',
    );
  }

  async function compress(
    history: ReadonlyArray<ConversationMessage>,
    conversationId: string,
  ): Promise<CompactionResult> {
    try {
      // 1. Split history
      const { toCompress, toKeep, priorSummary } = splitHistory(
        history,
        config.keepRecent,
      );

      // 2. Check if there's anything to compress
      if (toCompress.length === 0) {
        // No-op: return original history
        const tokensBefore = estimateTokens(
          history.map((m) => m.content).join(''),
        );
        return {
          history,
          batchesCreated: 0,
          messagesCompressed: 0,
          tokensEstimateBefore: tokensBefore,
          tokensEstimateAfter: tokensBefore,
        };
      }

      // 3. Get system prompt for summarization
      const systemPrompt = config.prompt;

      // 4. Chunk messages
      const chunks = chunkMessages(toCompress, config.chunkSize);

      // 5. Summarize each chunk (fold-in pattern)
      const batches: Array<SummaryBatch> = [];
      let accumulatedSummary = priorSummary?.content || '';

      for (const chunk of chunks) {
        const summaryText = await summarizeChunk(
          chunk,
          accumulatedSummary,
          systemPrompt,
        );
        accumulatedSummary = summaryText;

        const firstChunkMsg = chunk[0];
        const lastChunkMsg = chunk[chunk.length - 1];
        if (firstChunkMsg && lastChunkMsg) {
          const batch: SummaryBatch = {
            content: summaryText,
            depth: 0,
            startTime: firstChunkMsg.created_at,
            endTime: lastChunkMsg.created_at,
            messageCount: chunk.length,
          };

          batches.push(batch);
        }
      }

      // 6. Archive each batch
      for (const batch of batches) {
        await archiveBatch(batch, conversationId);
      }

      // 7. Check if re-summarization is needed and perform it
      const allBatches = await getCompactionBatches(memory, conversationId);
      if (shouldResummarize(allBatches.length, config)) {
        await resummarizeBatches({
          batches: allBatches,
          conversationId,
          memory,
          model,
          modelName,
          config,
          systemPrompt,
        });
      }

      // 8. Rebuild batch list after potential re-summarization
      const finalBatches = await getCompactionBatches(memory, conversationId);

      // 9. Delete old messages from database
      const idsToDelete = toCompress.map((m) => m.id);
      await persistence.query(
        'DELETE FROM messages WHERE id = ANY($1)',
        [idsToDelete],
      );

      // 10. Build clip-archive content
      const clipArchiveContent = buildClipArchive(
        finalBatches.map((b) => b.batch),
        config,
        toCompress.length,
      );

      // 11. Insert clip-archive as a system message
      const clipArchiveId = randomUUID();
      const now = new Date();
      await persistence.query(
        'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)',
        [clipArchiveId, conversationId, 'system', clipArchiveContent, now],
      );

      // 12. Build the clip-archive ConversationMessage object
      const clipArchiveMessage: ConversationMessage = {
        id: clipArchiveId,
        conversation_id: conversationId,
        role: 'system',
        content: clipArchiveContent,
        created_at: now,
      };

      // 13. Calculate token estimates
      const tokensBefore = estimateTokens(
        history.map((m) => m.content).join(''),
      );
      const compressedHistory = [clipArchiveMessage, ...toKeep];
      const tokensAfter = estimateTokens(
        compressedHistory.map((m) => m.content).join(''),
      );

      // 14. Return result
      return {
        history: compressedHistory,
        batchesCreated: batches.length,
        messagesCompressed: toCompress.length,
        tokensEstimateBefore: tokensBefore,
        tokensEstimateAfter: tokensAfter,
      };
    } catch (error) {
      // Error handling: return original history unchanged
      // TODO: Replace console.error with injected logger for proper observability
      console.error('compaction pipeline failed', { conversationId, error: String(error) });
      const tokenEstimate = estimateTokens(
        history.map((m) => m.content).join(''),
      );
      return {
        history,
        batchesCreated: 0,
        messagesCompressed: 0,
        tokensEstimateBefore: tokenEstimate,
        tokensEstimateAfter: tokenEstimate,
      };
    }
  }

  return { compress };
}
