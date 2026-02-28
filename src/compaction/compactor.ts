// pattern: Imperative Shell

/**
 * Core compaction pipeline implementation.
 * Orchestrates: split, chunk, summarize, archive, delete old messages, and build clip-archive.
 * Dependencies: ModelProvider (LLM summarization), MemoryManager (archival writes),
 * PersistenceProvider (message deletion), CompactionConfig (tuning parameters).
 */

import { randomUUID } from 'crypto';
import type { ConversationMessage } from '../agent/types.js';
import type { ModelProvider, ModelRequest, TextBlock } from '../model/types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PersistenceProvider } from '../persistence/types.js';
import type {
  SummaryBatch,
  CompactionResult,
  CompactionConfig,
  Compactor,
} from './types.js';
import {
  DEFAULT_SUMMARIZATION_PROMPT,
  interpolatePrompt,
} from './prompt.js';

export type CreateCompactorOptions = {
  readonly model: ModelProvider;
  readonly memory: MemoryManager;
  readonly persistence: PersistenceProvider;
  readonly config: CompactionConfig;
  readonly modelName: string;
  readonly getPersona: () => Promise<string>;
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
 * Convert messages to a string format for the summarization prompt.
 * Format: "role: content\n" for each message.
 */
export function formatMessagesForPrompt(
  messages: ReadonlyArray<ConversationMessage>,
): string {
  return messages
    .map((msg) => `${msg.role}: ${msg.content}`)
    .join('\n');
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
    // Show all batches
    earliestBatches = batches;
    recentBatches = [];
  } else {
    // Show first clipFirst, then omission, then last clipLast
    earliestBatches = batches.slice(0, clipFirst);
    recentBatches = batches.slice(totalBatches - clipLast);
    hasOmission = true;
  }

  // Earliest context section
  if (earliestBatches.length > 0) {
    lines.push('## Earliest context');
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

  // Recent context section
  if (recentBatches.length > 0) {
    lines.push('## Recent context');
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

export function createCompactor(
  options: CreateCompactorOptions,
): Compactor {
  const { model, memory, persistence, config, modelName, getPersona } = options;

  async function summarizeChunk(
    chunk: ReadonlyArray<ConversationMessage>,
    existingSummary: string,
    persona: string,
    template: string,
  ): Promise<string> {
    const messagesText = formatMessagesForPrompt(chunk);
    const prompt = interpolatePrompt({
      template,
      persona,
      existingSummary,
      messages: messagesText,
    });

    const request: ModelRequest = {
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      model: modelName,
      max_tokens: config.maxSummaryTokens,
      temperature: 0,
    };

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
    await memory.write(
      label,
      batch.content,
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

      // 3. Get persona for prompts
      const persona = await getPersona();
      const template = config.prompt || DEFAULT_SUMMARIZATION_PROMPT;

      // 4. Chunk messages
      const chunks = chunkMessages(toCompress, config.chunkSize);

      // 5. Summarize each chunk (fold-in pattern)
      const batches: Array<SummaryBatch> = [];
      let accumulatedSummary = priorSummary?.content || '';

      for (const chunk of chunks) {
        const summaryText = await summarizeChunk(
          chunk,
          accumulatedSummary,
          persona,
          template,
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

      // 7. Delete old messages from database
      const idsToDelete = toCompress.map((m) => m.id);
      await persistence.query(
        'DELETE FROM messages WHERE id = ANY($1)',
        [idsToDelete],
      );

      // 8. Build clip-archive content
      const clipArchiveContent = buildClipArchive(
        batches,
        config,
        toCompress.length,
      );

      // 9. Insert clip-archive as a system message
      const clipArchiveId = randomUUID();
      const now = new Date();
      await persistence.query(
        'INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)',
        [clipArchiveId, conversationId, 'system', clipArchiveContent, now],
      );

      // 10. Build the clip-archive ConversationMessage object
      const clipArchiveMessage: ConversationMessage = {
        id: clipArchiveId,
        conversation_id: conversationId,
        role: 'system',
        content: clipArchiveContent,
        created_at: now,
      };

      // 11. Calculate token estimates
      const tokensBefore = estimateTokens(
        history.map((m) => m.content).join(''),
      );
      const compressedHistory = [clipArchiveMessage, ...toKeep];
      const tokensAfter = estimateTokens(
        compressedHistory.map((m) => m.content).join(''),
      );

      // 12. Return result
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
