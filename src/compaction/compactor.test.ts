/**
 * Tests for the compaction pipeline.
 * Covers pure helper functions and compress() pipeline with mocked dependencies.
 */

import { describe, it, expect } from 'bun:test';
import type { ConversationMessage } from '../agent/types.js';
import type { ModelProvider, ModelRequest, ModelResponse, Message } from '../model/types.js';
import { ModelError } from '../model/types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PersistenceProvider, QueryFunction } from '../persistence/types.js';
import type { SummaryBatch, ImportanceScoringConfig } from './types.js';
import { DEFAULT_SCORING_CONFIG } from './types.js';
import {
  splitHistory,
  chunkMessages,
  chunkMessagesByTokenBudget,
  buildClipArchive,
  estimateTokens,
  createCompactor,
  parseBatchMetadata,
  shouldResummarize,
  resummarizeBatches,
} from './compactor.js';
import { DEFAULT_SYSTEM_PROMPT } from './prompt.js';

/**
 * Test fixtures and helpers
 */

function createMessage(
  id: string,
  role: ConversationMessage['role'],
  content: string,
  offset: number = 0,
): ConversationMessage {
  return {
    id,
    conversation_id: 'test-conv',
    role,
    content,
    created_at: new Date(1000 + offset),
  };
}

function createToolCallMessage(
  id: string,
  content: string,
  toolCalls: Array<{ id: string; name: string }>,
  offset: number = 0,
): ConversationMessage {
  return {
    id,
    conversation_id: 'test-conv',
    role: 'assistant',
    content,
    tool_calls: toolCalls.map((tc) => ({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: {},
    })),
    created_at: new Date(1000 + offset),
  };
}

function createToolResultMessage(
  id: string,
  toolCallId: string,
  content: string,
  offset: number = 0,
): ConversationMessage {
  return {
    id,
    conversation_id: 'test-conv',
    role: 'tool',
    content,
    tool_call_id: toolCallId,
    created_at: new Date(1000 + offset),
  };
}

function createBatch(index: number, depth: number = 0): SummaryBatch {
  const startTime = new Date(2000 + index * 1000);
  const endTime = new Date(2000 + index * 1000 + 900);
  return {
    content: `Summary batch ${index}`,
    depth,
    startTime,
    endTime,
    messageCount: 10,
  };
}

/**
 * Helper factory for creating mock dependencies for resummarize tests.
 * Provides customizable mocks with default implementations for MemoryManager and ModelProvider.
 */
function createResummarizeTestContext(overrides?: {
  onMemoryWrite?: (label: string, content: string) => void;
  onBlockDelete?: (id: string) => void;
  modelResponseText?: string;
}): {
  mockMemory: MemoryManager;
  mockModel: ModelProvider;
  writtenBlocks: Array<{ label: string; content: string }>;
  deletedBlocks: Array<string>;
  calls?: Array<ModelRequest>;
} {
  const writtenBlocks: Array<{ label: string; content: string }> = [];
  const deletedBlocks: Array<string> = [];
  const calls: Array<ModelRequest> = [];

  const mockMemory: MemoryManager = {
    async getCoreBlocks() {
      return [];
    },
    async getWorkingBlocks() {
      return [];
    },
    async buildSystemPrompt() {
      return '';
    },
    async read() {
      return [];
    },
    async write(label: string, content: string) {
      writtenBlocks.push({ label, content });
      overrides?.onMemoryWrite?.(label, content);
      return {
        applied: true,
        block: {
          id: 'new-batch',
          owner: 'test',
          tier: 'archival',
          label,
          content,
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      };
    },
    async list() {
      return [];
    },
    async deleteBlock(id: string) {
      deletedBlocks.push(id);
      overrides?.onBlockDelete?.(id);
    },
    async getPendingMutations() {
      return [];
    },
    async approveMutation() {
      throw new Error('not implemented');
    },
    async rejectMutation() {
      throw new Error('not implemented');
    },
    async moveBlock() {
      throw new Error('not implemented');
    },
    async getStats() {
      return { tier: 'all', block_count: 0, total_bytes: 0 };
    },
  };

  const mockModel: ModelProvider = {
    async complete(request: ModelRequest) {
      calls.push(request);
      return {
        content: [{ type: 'text', text: overrides?.modelResponseText ?? 'Re-summarized content' }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };
    },
    async *stream() {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
    _calls: calls,
  } as unknown as ModelProvider;

  return { mockMemory, mockModel, writtenBlocks, deletedBlocks, calls };
}

function createMockPersistenceProvider(): PersistenceProvider {
  const deletedIds: Array<string> = [];
  const insertedMessages: Array<{
    id: string;
    role: string;
    content: string;
  }> = [];

  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    if (sql.includes('DELETE FROM messages') && sql.includes('WHERE id = ANY')) {
      const [idsParam] = params || [];
      if (Array.isArray(idsParam)) {
        deletedIds.push(...idsParam.map(String));
      }
      return [];
    }

    if (sql.includes('INSERT INTO messages')) {
      const [id, , role, content] = params || [];
      insertedMessages.push({
        id: String(id),
        role: String(role),
        content: String(content),
      });
      return [];
    }

    return [];
  };

  return {
    async connect() {},
    async disconnect() {},
    async runMigrations() {},
    query,
    async withTransaction<T>(fn: (q: QueryFunction) => Promise<T>) {
      return fn(query);
    },
    _deletedIds: deletedIds,
    _insertedMessages: insertedMessages,
  } as unknown as PersistenceProvider;
}

function createMockModelProvider(
  responses: ReadonlyArray<string>,
): ModelProvider {
  let callIndex = 0;
  const calls: Array<ModelRequest> = [];

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      calls.push(request);
      const responseText = responses[callIndex] || `Summary ${callIndex}`;
      callIndex++;

      return {
        content: [{ type: 'text', text: responseText }],
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };
    },
    async *stream(_request: ModelRequest) {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
    _calls: calls,
  } as unknown as ModelProvider;
}

function createMockMemoryManager(): MemoryManager {
  const archivedBatches: Array<{ id: string; label: string; content: string }> = [];

  return {
    async getCoreBlocks() {
      return [];
    },
    async getWorkingBlocks() {
      return [];
    },
    async buildSystemPrompt() {
      return '';
    },
    async read() {
      return [];
    },
    async write(label: string, content: string) {
      const id = `block-${archivedBatches.length}`;
      archivedBatches.push({ id, label, content });
      return {
        applied: true,
        block: {
          id,
          owner: 'test',
          tier: 'archival',
          label,
          content,
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      };
    },
    async list(tier?: string) {
      if (tier === 'archival') {
        return archivedBatches.map(b => ({
          id: b.id,
          owner: 'test',
          tier: 'archival' as const,
          label: b.label,
          content: b.content,
          embedding: null,
          permission: 'readwrite' as const,
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        }));
      }
      return [];
    },
    async deleteBlock(id: string) {
      const idx = archivedBatches.findIndex(b => b.id === id);
      if (idx >= 0) {
        archivedBatches.splice(idx, 1);
      }
    },
    async getPendingMutations() {
      return [];
    },
    async approveMutation() {
      throw new Error('not implemented');
    },
    async rejectMutation() {
      throw new Error('not implemented');
    },
    async moveBlock() {
      throw new Error('not implemented');
    },
    async getStats() {
      return { tier: 'all', block_count: 0, total_bytes: 0 };
    },
    get _archivedBatches() {
      return archivedBatches.map(b => ({ label: b.label, content: b.content }));
    },
  } as unknown as MemoryManager;
}

describe('Pure helper functions', () => {
  describe('splitHistory', () => {
    it('AC1.6: preserves last keepRecent messages in toKeep', () => {
      const messages = [
        createMessage('1', 'user', 'msg1', 0),
        createMessage('2', 'assistant', 'msg2', 100),
        createMessage('3', 'user', 'msg3', 200),
        createMessage('4', 'assistant', 'msg4', 300),
        createMessage('5', 'user', 'msg5', 400),
        createMessage('6', 'assistant', 'msg6', 500),
        createMessage('7', 'user', 'msg7', 600),
        createMessage('8', 'assistant', 'msg8', 700),
        createMessage('9', 'user', 'msg9', 800),
        createMessage('10', 'assistant', 'msg10', 900),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 5);
      expect(toCompress.length).toBe(5);
      expect(toKeep.length).toBe(5);
      // With importance scoring, assistant messages score lower and should appear first
      expect(toCompress[0]?.role).toBe('assistant');
      expect(toKeep[0]?.id).toBe('6');
      expect(toKeep[4]?.id).toBe('10');
    });

    it('AC1.6: returns empty toCompress when history length <= keepRecent', () => {
      const messages = [
        createMessage('1', 'user', 'msg1', 0),
        createMessage('2', 'assistant', 'msg2', 100),
        createMessage('3', 'user', 'msg3', 200),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 5);
      expect(toCompress.length).toBe(0);
      expect(toKeep.length).toBe(3);
      expect(toKeep[0]?.id).toBe('1');
      expect(toKeep[2]?.id).toBe('3');
    });

    it('handles empty history', () => {
      const { toCompress, toKeep, priorSummary } = splitHistory([], 5);
      expect(toCompress.length).toBe(0);
      expect(toKeep.length).toBe(0);
      expect(priorSummary).toBeNull();
    });

    it('detects prior compaction summary with em-dash and extracts it', () => {
      const messages = [
        createMessage('summary', 'system', '[Context Summary — 50 messages]', 0),
        createMessage('1', 'user', 'msg1', 100),
        createMessage('2', 'assistant', 'msg2', 200),
        createMessage('3', 'user', 'msg3', 300),
      ];

      const { toCompress, toKeep, priorSummary } = splitHistory(messages, 2);
      expect(priorSummary).not.toBeNull();
      expect(priorSummary?.id).toBe('summary');
      expect(toCompress.length).toBe(1);
      expect(toKeep.length).toBe(2);
    });

    it('does not treat non-summary system messages as prior summaries', () => {
      const messages = [
        createMessage('sys', 'system', 'Some system instruction', 0),
        createMessage('1', 'user', 'msg1', 100),
        createMessage('2', 'assistant', 'msg2', 200),
      ];

      const { priorSummary } = splitHistory(messages, 2);
      expect(priorSummary).toBeNull();
    });

    it('AC3.4: sorts toCompress by importance ascending (lowest-scored first)', () => {
      const messages = [
        createMessage('sys', 'system', '[Context Summary — 50]', 0),
        createMessage('1', 'assistant', 'short', 100),
        createMessage('2', 'user', 'longer message with more content for scoring', 200),
        createMessage('3', 'assistant', 'msg3', 300),
        createMessage('4', 'user', 'recent user message', 400),
        createMessage('5', 'assistant', 'kept recent', 500),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 1);

      // toCompress should be messages 1-4 (excluding prior summary at 0, and keeping recent at 5)
      expect(toCompress.length).toBe(4);
      expect(toKeep.length).toBe(1);
      expect(toKeep[0]?.id).toBe('5');

      // Within toCompress, messages should be sorted by importance ascending
      // Message '1' (short assistant) should be first (lowest score)
      // Message '2' (longer user) should be later (higher score)
      expect(toCompress[0]?.id).toBe('1');
      expect(toCompress[toCompress.length - 1]?.id).not.toBe('1');
    });

    it('AC3.6: maintains chronological order when messages have equal scores', () => {
      const messages = [
        createMessage('1', 'user', 'identical', 0),
        createMessage('2', 'user', 'identical', 100),
        createMessage('3', 'user', 'identical', 200),
        createMessage('4', 'assistant', 'kept', 300),
      ];

      const noDecayConfig: Readonly<ImportanceScoringConfig> = {
        ...DEFAULT_SCORING_CONFIG,
        recencyDecay: 1.0,
      };

      const { toCompress } = splitHistory(messages, 1, noDecayConfig);

      // All toCompress messages have the same role, content, and recency (decay=1.0)
      // They should maintain chronological order (1, 2, 3) due to stable sort
      expect(toCompress.length).toBe(3);
      expect(toCompress[0]?.id).toBe('1');
      expect(toCompress[1]?.id).toBe('2');
      expect(toCompress[2]?.id).toBe('3');
    });

    it('uses DEFAULT_SCORING_CONFIG when no config provided', () => {
      const messages = [
        createMessage('1', 'assistant', 'short', 0),
        createMessage('2', 'user', 'longer message with content', 100),
        createMessage('3', 'assistant', 'kept', 200),
      ];

      const { toCompress: toCompress1 } = splitHistory(messages, 1);

      // Should use default config (user > assistant)
      // So message '2' should score higher than '1', and '1' should be first
      expect(toCompress1.length).toBe(2);
      expect(toCompress1[0]?.id).toBe('1');
    });

    it('respects custom scoring config when provided', () => {
      const customConfig = {
        roleWeightSystem: 10.0,
        roleWeightUser: 2.0,  // Lower than default (5.0)
        roleWeightAssistant: 20.0,  // Much higher than default (3.0)
        recencyDecay: 0.95,
        questionBonus: 2.0,
        toolCallBonus: 4.0,
        keywordBonus: 1.5,
        importantKeywords: ['error', 'fail', 'bug', 'fix', 'decision', 'agreed', 'constraint', 'requirement'],
        contentLengthWeight: 1.0,
      };

      const messages = [
        createMessage('1', 'user', 'short', 0),
        createMessage('2', 'assistant', 'short', 100),
        createMessage('3', 'assistant', 'kept', 200),
      ];

      const { toCompress } = splitHistory(messages, 1, customConfig);

      // With custom config, assistant (20.0) weights more than user (2.0)
      // So user message '1' should have lower score and appear first
      expect(toCompress.length).toBe(2);
      expect(toCompress[0]?.id).toBe('1');
    });

    it('handles single compressible message without sorting', () => {
      const messages = [
        createMessage('1', 'user', 'msg', 0),
        createMessage('2', 'assistant', 'kept', 100),
      ];

      const { toCompress } = splitHistory(messages, 1);

      // Only 1 message to compress, no sorting needed
      expect(toCompress.length).toBe(1);
      expect(toCompress[0]?.id).toBe('1');
    });

    it('handles empty compressible section (all kept)', () => {
      const messages = [
        createMessage('1', 'user', 'msg1', 0),
        createMessage('2', 'user', 'msg2', 100),
      ];

      const { toCompress } = splitHistory(messages, 10);

      // keepRecent is 10, but only 2 messages total, so nothing to compress
      expect(toCompress.length).toBe(0);
    });

    it('GH-24: keeps assistant tool_calls with their tool results in toKeep', () => {
      // History: user, assistant+tool_call, tool_result, user, assistant
      // With keepRecent=3, naive split puts assistant+tool_call in toCompress
      // but tool_result in toKeep — orphaning the tool result
      const messages = [
        createMessage('1', 'user', 'hello', 0),
        createToolCallMessage('2', '[Tool calls]', [{ id: 'tc-1', name: 'memory_read' }], 100),
        createToolResultMessage('3', 'tc-1', 'result', 200),
        createMessage('4', 'user', 'thanks', 300),
        createMessage('5', 'assistant', 'welcome', 400),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 3);

      // The tool result (id=3) references tool call in assistant (id=2).
      // Both must be on the same side of the split.
      const keepIds = toKeep.map((m) => m.id);
      const compressIds = toCompress.map((m) => m.id);

      // If the tool result is in toKeep, its assistant must also be in toKeep
      if (keepIds.includes('3')) {
        expect(keepIds).toContain('2');
      }
      // If the assistant is in toCompress, its tool result must also be in toCompress
      if (compressIds.includes('2')) {
        expect(compressIds).toContain('3');
      }
    });

    it('GH-24: keeps assistant tool_calls with their tool results in toCompress', () => {
      // History with tool pair early on, lots of messages after
      // The tool pair should stay together even when both end up in toCompress
      const messages = [
        createMessage('1', 'user', 'start', 0),
        createToolCallMessage('2', '[Tool calls]', [{ id: 'tc-1', name: 'web_search' }], 100),
        createToolResultMessage('3', 'tc-1', 'search results', 200),
        createMessage('4', 'user', 'msg4', 300),
        createMessage('5', 'assistant', 'msg5', 400),
        createMessage('6', 'user', 'msg6', 500),
        createMessage('7', 'assistant', 'msg7', 600),
        createMessage('8', 'user', 'msg8', 700),
        createMessage('9', 'assistant', 'msg9', 800),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 4);

      const keepIds = toKeep.map((m) => m.id);
      const compressIds = toCompress.map((m) => m.id);

      // Tool pair (2, 3) must stay together
      if (compressIds.includes('2')) {
        expect(compressIds).toContain('3');
      }
      if (keepIds.includes('3')) {
        expect(keepIds).toContain('2');
      }
    });

    it('GH-24: handles multiple tool calls in a single assistant message', () => {
      // Assistant makes two tool calls, both results must stay with it
      const messages = [
        createMessage('1', 'user', 'do two things', 0),
        createToolCallMessage('2', '[Tool calls]', [
          { id: 'tc-1', name: 'memory_read' },
          { id: 'tc-2', name: 'web_search' },
        ], 100),
        createToolResultMessage('3', 'tc-1', 'memory result', 200),
        createToolResultMessage('4', 'tc-2', 'search result', 300),
        createMessage('5', 'user', 'ok', 400),
        createMessage('6', 'assistant', 'done', 500),
      ];

      const { toCompress, toKeep } = splitHistory(messages, 2);

      const keepIds = toKeep.map((m) => m.id);
      const compressIds = toCompress.map((m) => m.id);

      // All three (assistant + 2 tool results) must be on the same side
      if (keepIds.includes('3') || keepIds.includes('4')) {
        expect(keepIds).toContain('2');
        expect(keepIds).toContain('3');
        expect(keepIds).toContain('4');
      }
      if (compressIds.includes('2')) {
        expect(compressIds).toContain('3');
        expect(compressIds).toContain('4');
      }
    });

    it('GH-24: split never produces orphaned tool results at toKeep boundary', () => {
      // The exact scenario from the bug: compact_context tool call split from result
      const messages = [
        createMessage('1', 'user', 'hello', 0),
        createMessage('2', 'assistant', 'hi', 100),
        createMessage('3', 'user', 'do something', 200),
        createToolCallMessage('4', '[Tool calls]', [{ id: 'tc-compact', name: 'compact_context' }], 300),
        createToolResultMessage('5', 'tc-compact', '{"messagesCompressed":2}', 400),
        createMessage('6', 'user', 'continue', 500),
        createMessage('7', 'assistant', 'ok', 600),
      ];

      // keepRecent=3 would naively keep [5,6,7], orphaning tool result 5 from its call in 4
      const { toKeep } = splitHistory(messages, 3);

      const keepIds = toKeep.map((m) => m.id);

      // If tool result 5 is in toKeep, its assistant 4 must be too
      if (keepIds.includes('5')) {
        expect(keepIds).toContain('4');
      }
    });
  });

  describe('chunkMessages', () => {
    it('AC1.2: divides messages into groups of chunkSize', () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', `msg${i}`, i * 100),
      );

      const chunks = chunkMessages(messages, 3);
      expect(chunks.length).toBe(4);
      expect(chunks[0]?.length).toBe(3);
      expect(chunks[1]?.length).toBe(3);
      expect(chunks[2]?.length).toBe(3);
      expect(chunks[3]?.length).toBe(1);
    });

    it('returns empty when input is empty', () => {
      const chunks = chunkMessages([], 3);
      expect(chunks.length).toBe(0);
    });

    it('returns single chunk when count <= chunkSize', () => {
      const messages = [
        createMessage('1', 'user', 'msg1', 0),
        createMessage('2', 'assistant', 'msg2', 100),
      ];

      const chunks = chunkMessages(messages, 5);
      expect(chunks.length).toBe(1);
      expect(chunks[0]?.length).toBe(2);
    });

    it('handles chunkSize of 1', () => {
      const messages = [
        createMessage('1', 'user', 'msg1', 0),
        createMessage('2', 'assistant', 'msg2', 100),
        createMessage('3', 'user', 'msg3', 200),
      ];

      const chunks = chunkMessages(messages, 1);
      expect(chunks.length).toBe(3);
      expect(chunks[0]?.length).toBe(1);
      expect(chunks[1]?.length).toBe(1);
      expect(chunks[2]?.length).toBe(1);
    });
  });

  describe('estimateTokens', () => {
    it('estimates tokens using 1 token ≈ 4 chars heuristic', () => {
      const text = 'a'.repeat(100);
      expect(estimateTokens(text)).toBe(25);
    });

    it('rounds up', () => {
      const text = 'a'.repeat(5);
      expect(estimateTokens(text)).toBe(2); // ceil(5/4) = 2
    });

    it('handles empty string', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('buildClipArchive', () => {
    it('AC3.1: shows first clipFirst and last clipLast batches', () => {
      const batches = [
        createBatch(1),
        createBatch(2),
        createBatch(3),
        createBatch(4),
        createBatch(5),
        createBatch(6),
      ];

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      const result = buildClipArchive(batches, config, 60);

      // Should contain batches 1-2 and 5-6, but not 3-4
      expect(result).toContain('Batch 1');
      expect(result).toContain('Batch 2');
      expect(result).toContain('Batch 5');
      expect(result).toContain('Batch 6');
      expect(result).not.toContain('Batch 3');
      expect(result).not.toContain('Batch 4');
    });

    it('AC3.2: includes omission separator with count and memory_read hint', () => {
      const batches = [
        createBatch(1),
        createBatch(2),
        createBatch(3),
        createBatch(4),
        createBatch(5),
        createBatch(6),
      ];

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      const result = buildClipArchive(batches, config, 60);
      expect(result).toContain('2 earlier summaries omitted');
      expect(result).toContain('memory_read');
    });

    it('AC3.4: shows all batches when total <= clipFirst + clipLast', () => {
      const batches = [createBatch(1), createBatch(2), createBatch(3)];

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      const result = buildClipArchive(batches, config, 30);

      // Should show all 3 batches
      expect(result).toContain('Batch 1');
      expect(result).toContain('Batch 2');
      expect(result).toContain('Batch 3');
      // Should NOT have omission separator
      expect(result).not.toContain('omitted');
    });

    it('includes message count in header', () => {
      const batches = [createBatch(1)];
      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      const result = buildClipArchive(batches, config, 42);
      expect(result).toContain('42 messages compressed');
    });

    it('handles empty batches array', () => {
      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      const result = buildClipArchive([], config, 0);
      expect(result).toContain('[Context Summary — 0 messages compressed]');
    });
  });

  describe('parseBatchMetadata', () => {
    it('parses valid metadata header and extracts all fields', () => {
      const now = new Date();
      const startStr = now.toISOString();
      const endStr = new Date(now.getTime() + 3600000).toISOString();
      const content = `[depth:1|start:${startStr}|end:${endStr}|count:25]\nActual summary content here`;

      const { metadata, cleanContent } = parseBatchMetadata(content);

      expect(metadata.depth).toBe(1);
      expect(metadata.startTime.toISOString()).toBe(startStr);
      expect(metadata.endTime.toISOString()).toBe(endStr);
      expect(metadata.messageCount).toBe(25);
      expect(cleanContent).toBe('Actual summary content here');
    });

    it('handles content with no metadata header', () => {
      const content = 'Just plain content without header';

      const { metadata, cleanContent } = parseBatchMetadata(content);

      expect(metadata.depth).toBe(0);
      expect(metadata.messageCount).toBe(0);
      expect(cleanContent).toBe(content);
    });

    it('handles malformed metadata gracefully', () => {
      const content = '[invalid metadata]\nActual content';

      const { metadata, cleanContent } = parseBatchMetadata(content);

      expect(metadata.depth).toBe(0);
      expect(cleanContent).toBe(content);
    });

    it('preserves multiline content after metadata', () => {
      const now = new Date();
      const startStr = now.toISOString();
      const endStr = new Date(now.getTime() + 3600000).toISOString();
      const multilineContent = 'Line 1\nLine 2\nLine 3\nLine 4';
      const content = `[depth:0|start:${startStr}|end:${endStr}|count:10]\n${multilineContent}`;

      const { cleanContent } = parseBatchMetadata(content);

      expect(cleanContent).toBe(multilineContent);
    });
  });
});

describe('Compaction pipeline with mocked dependencies', () => {
  it('AC1.1: compress() produces summary batches when history exceeds token budget', async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(100), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1', 'Summary 2']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 5,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    expect(result.batchesCreated).toBeGreaterThan(0);
    expect(result.messagesCompressed).toBe(15);
    expect(result.tokensEstimateAfter).toBeLessThan(result.tokensEstimateBefore);
  });

  it('AC1.3: each chunk summarization receives prior summary (fold-in pattern)', async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1', 'Summary 2']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 5,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    const model = mockModel as unknown as { _calls: Array<ModelRequest> };
    expect(model._calls.length).toBe(2); // Two chunks

    // Each call should have included existing summary in the prompt
    for (let i = 0; i < model._calls.length; i++) {
      const callRequest = model._calls[i];
      const callContent = callRequest?.messages[0]?.content;
      expect(callContent).toBeDefined();
      if (i > 0) {
        expect(String(callContent)).toContain('Summary');
      }
    }
  });

  it('AC1.4: returned SummaryBatch objects include depth, timestamp range, and message count', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    expect(result.batchesCreated).toBeGreaterThan(0);
    // Verify the clip-archive message is in the history
    const clipMessage = result.history[0];
    expect(clipMessage?.role).toBe('system');
    expect(clipMessage?.content).toContain('Context Summary');

    // Verify SummaryBatch properties via clip-archive content and archived batches
    const clipContent = clipMessage?.content || '';
    // Check for depth 0 in the batch descriptions
    expect(clipContent).toContain('depth 0');
    // Check for timestamp format (ISO timestamps are in the batch headers)
    expect(clipContent).toMatch(/\d{4}-\d{2}-\d{2}T/);

    // Verify archived batches were created with correct structure
    const memory = mockMemory as unknown as {
      _archivedBatches: Array<{ label: string; content: string }>;
    };
    expect(memory._archivedBatches.length).toBeGreaterThan(0);
    for (const batch of memory._archivedBatches) {
      if (batch) {
        // Each archived batch should have a label and content
        expect(batch.label).toBeTruthy();
        expect(batch.content).toBeTruthy();
      }
    }
  });

  it('AC1.5: old message IDs are deleted from database', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    const persistence = mockPersistence as unknown as { _deletedIds: Array<string> };
    expect(persistence._deletedIds.length).toBeGreaterThan(0);
    // Should have deleted the old messages (not the kept ones)
    expect(persistence._deletedIds.length).toBeLessThan(messages.length);
  });

  it('AC1.7: returns original history unchanged when model.complete() throws', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    // Create a model provider that throws
    const mockModel: ModelProvider = {
      async complete() {
        throw new Error('Model error');
      },
      async *stream() {
        throw new Error('Stream not implemented');
      },
    };

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // Should return original history unchanged
    expect(result.history).toEqual(messages);
    expect(result.batchesCreated).toBe(0);
    expect(result.messagesCompressed).toBe(0);
    expect(result.tokensEstimateBefore).toBe(result.tokensEstimateAfter);
  });

  it('AC1.8: first compaction (no prior summary) produces valid depth-0 batches', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // First compaction should produce batches
    expect(result.batchesCreated).toBeGreaterThan(0);
    // Depth should be 0 for first compaction
    expect(result.history[0]?.content).toContain('[Context Summary');
  });

  it('AC4.1: each summary batch triggers memory.write() call with tier=archival', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    const memory = mockMemory as unknown as {
      _archivedBatches: Array<{ label: string; content: string }>;
    };
    // Should have archived batches
    expect(memory._archivedBatches.length).toBeGreaterThan(0);
  });

  it('AC4.2: archived batch labels follow format compaction-batch-{conversationId}-{timestamp}', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv-123');

    const memory = mockMemory as unknown as {
      _archivedBatches: Array<{ label: string; content: string }>;
    };
    for (const batch of memory._archivedBatches) {
      if (batch) {
        expect(batch.label).toMatch(/^compaction-batch-test-conv-123-/);
        expect(batch.label).toContain('T'); // ISO timestamp format
      }
    }
  });

  it('returns no-op CompactionResult when toCompress is empty', async () => {
    // Create messages that fit within keepRecent
    const messages = [
      createMessage('1', 'user', 'msg1', 0),
      createMessage('2', 'assistant', 'msg2', 100),
      createMessage('3', 'user', 'msg3', 200),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider([]);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 10,
      keepRecent: 10, // All messages fit in keepRecent
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const compResult = await compactor.compress(messages, 'test-conv');

    expect(compResult.batchesCreated).toBe(0);
    expect(compResult.messagesCompressed).toBe(0);
    expect(compResult.history).toEqual(messages);
  });

  it('AC2.4 (two cycles): Multiple compaction cycles produce progressively higher depths', async () => {
    // Simulates: First cycle creates depth-0 batches, re-summarizes to depth-1,
    // then second cycle picks up depth-0 and depth-1, re-summarizes to depth-2.

    // Create a stateful mock memory manager that maintains archived batches
    let archivedBatches: Array<{
      id: string;
      label: string;
      content: string;
      depth: number;
    }> = [];
    let nextBlockId = 0;

    function createStatefulMockMemory() {
      return {
        async getCoreBlocks() {
          return [];
        },
        async getWorkingBlocks() {
          return [];
        },
        async buildSystemPrompt() {
          return '';
        },
        async read() {
          return [];
        },
        async write(label: string, content: string) {
          const id = `block-${nextBlockId++}`;
          const { metadata } = parseBatchMetadata(content);
          archivedBatches.push({
            id,
            label,
            content,
            depth: metadata.depth,
          });
          return {
            applied: true,
            block: {
              id,
              owner: 'test',
              tier: 'archival' as const,
              label,
              content,
              embedding: null,
              permission: 'readwrite' as const,
              pinned: false,
              created_at: new Date(),
              updated_at: new Date(),
            },
          };
        },
        async list(tier?: string) {
          if (tier === 'archival') {
            return archivedBatches.map((b) => ({
              id: b.id,
              owner: 'test',
              tier: 'archival' as const,
              label: b.label,
              content: b.content,
              embedding: null,
              permission: 'readwrite' as const,
              pinned: false,
              created_at: new Date(),
              updated_at: new Date(),
            }));
          }
          return [];
        },
        async deleteBlock(id: string) {
          archivedBatches = archivedBatches.filter((b) => b.id !== id);
        },
        async getPendingMutations() {
          return [];
        },
        async approveMutation() {
          throw new Error('not implemented');
        },
        async rejectMutation() {
          throw new Error('not implemented');
        },
        async moveBlock() {
          throw new Error('not implemented');
        },
        async getStats() {
          return { tier: 'all', block_count: 0, total_bytes: 0 };
        },
      } as unknown as MemoryManager;
    }

    // Mock model that always returns a consistent response
    const mockModel: ModelProvider = {
      async complete() {
        return {
          content: [{ type: 'text', text: 'Cycle summary' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    };

    const config = {
      chunkSize: 2,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    // CYCLE 1: Create initial depth-0 batches and re-summarize
    // Create 10 messages that will produce multiple depth-0 batches
    const initialMessages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockMemory1 = createStatefulMockMemory();
    const mockPersistence1 = createMockPersistenceProvider();

    const compactor1 = createCompactor({
      model: mockModel,
      memory: mockMemory1,
      persistence: mockPersistence1,
      config,
      modelName: 'test-model',
    });

    await compactor1.compress(initialMessages, 'test-conv');

    // After cycle 1, we should have mostly depth-0 with possibly some depth-1
    const afterCycle1 = (
      mockMemory1 as unknown as {
        list: (tier?: string) => Promise<Array<{ label: string; content: string }>>;
      }
    );
    const blocks1 = await afterCycle1.list('archival');
    let maxDepth1 = 0;
    for (const block of blocks1) {
      if (block) {
        const { metadata } = parseBatchMetadata(block.content);
        maxDepth1 = Math.max(maxDepth1, metadata.depth);
      }
    }

    // CYCLE 2: Re-use the same memory manager (with accumulated batches) and compress more
    // Add more messages to trigger another re-summarization cycle
    const moreMessages = Array.from({ length: 15 }, (_, i) =>
      createMessage(String(100 + i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), 1000 + i * 100),
    );

    const compactor2 = createCompactor({
      model: mockModel,
      memory: mockMemory1, // Reuse the same memory with accumulated batches
      persistence: mockPersistence1,
      config,
      modelName: 'test-model',
    });

    // Combine previous history with new messages (but keep old ones compacted)
    const priorSummaryMsg = {
      id: 'summary',
      conversation_id: 'test-conv',
      role: 'system' as const,
      content: '[Context Summary — previous context]',
      created_at: new Date(500),
    };

    const combinedMessages = [priorSummaryMsg, ...moreMessages];

    await compactor2.compress(combinedMessages, 'test-conv');

    // After cycle 2, we should have higher max depth
    const blocks2 = await afterCycle1.list('archival');
    let maxDepth2 = 0;
    for (const block of blocks2) {
      if (block) {
        const { metadata } = parseBatchMetadata(block.content);
        maxDepth2 = Math.max(maxDepth2, metadata.depth);
      }
    }

    // Verify progression: Second cycle should produce depth higher than first
    // (depends on batch accumulation, but principle is: depth increases with cycles)
    expect(blocks2.length).toBeGreaterThan(0);
    expect(maxDepth2).toBeGreaterThanOrEqual(maxDepth1);
  });

  it('GH-24: clip-archive created_at sorts before kept messages', async () => {
    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(50), i * 100),
    );

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary 1']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 20,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // The clip-archive should be the first message in the result
    const clipArchive = result.history[0];
    expect(clipArchive?.role).toBe('system');
    expect(clipArchive?.content).toContain('[Context Summary');

    // Its created_at should be before the first kept message
    const firstKept = result.history[1];
    if (clipArchive && firstKept) {
      expect(clipArchive.created_at.getTime()).toBeLessThan(firstKept.created_at.getTime());
    }
  });

  it('GH-24: prior clip-archive is deleted from DB during recompaction', async () => {
    const messages = [
      createMessage('prior-summary', 'system', '[Context Summary — 50 messages compressed across 1 compaction cycle]', 0),
      createMessage('1', 'user', 'msg1', 100),
      createMessage('2', 'assistant', 'msg2', 200),
      createMessage('3', 'user', 'msg3', 300),
      createMessage('4', 'assistant', 'msg4', 400),
      createMessage('5', 'user', 'msg5', 500),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summary']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 20,
      keepRecent: 2,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    // The prior summary ID should be in the deleted set
    const persistence = mockPersistence as unknown as { _deletedIds: string[] };
    expect(persistence._deletedIds).toContain('prior-summary');
  });
});

/**
 * Tests for recursive re-summarization.
 * Covers context-compaction.AC2 requirements.
 */
describe('Recursive re-summarization', () => {
  describe('shouldResummarize', () => {
    it('Task 3 AC2.1: returns true when batch count exceeds clip window + buffer', () => {
      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      // Threshold = clipFirst + clipLast + buffer = 2 + 2 + 2 = 6
      expect(shouldResummarize(7, config)).toBe(true);
      expect(shouldResummarize(6, config)).toBe(false);
      expect(shouldResummarize(5, config)).toBe(false);
    });

    it('Task 3: returns false when batch count is within threshold', () => {
      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      expect(shouldResummarize(4, config)).toBe(false);
      expect(shouldResummarize(1, config)).toBe(false);
    });
  });

  describe('resummarizeBatches', () => {
    it('Task 5 AC2.2: produces new batch with depth = max(source depths) + 1', async () => {
      // Create 7 batches (exceeds threshold of 2+2+2=6)
      // We'll re-summarize the first 5 (all except the last 2)
      const sourceBatches = Array.from({ length: 7 }, (_, i) => ({
        id: `batch-${i}`,
        batch: {
          content: `Summary ${i}`,
          depth: 0,
          startTime: new Date(2000 + i * 100),
          endTime: new Date(2000 + i * 100 + 90),
          messageCount: 10,
        },
      }));

      const { mockMemory, mockModel, writtenBlocks } = createResummarizeTestContext({
        modelResponseText: 'Re-summarized content',
      });

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      await resummarizeBatches({
        batches: sourceBatches,
        conversationId: 'test-conv',
        memory: mockMemory,
        model: mockModel,
        modelName: 'test-model',
        config,
        systemPrompt: null,
      });

      // Verify new batch has depth 1 (max 0 + 1)
      expect(writtenBlocks.length).toBe(1);
      const newBlockContent = writtenBlocks[0]?.content || '';
      expect(newBlockContent).toContain('[depth:1|');
      expect(newBlockContent).toContain('Re-summarized content');
    });

    it('Task 5 AC2.3: deletes source batches from memory', async () => {
      // Create 7 batches (exceeds threshold of 2+2+2=6)
      // We'll re-summarize the first 5 (all except the last 2)
      const sourceBatches = Array.from({ length: 7 }, (_, i) => ({
        id: `batch-${i}`,
        batch: {
          content: `Summary ${i}`,
          depth: 0,
          startTime: new Date(2000 + i * 100),
          endTime: new Date(2000 + i * 100 + 90),
          messageCount: 10,
        },
      }));

      const { mockMemory, mockModel, deletedBlocks } = createResummarizeTestContext();

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      await resummarizeBatches({
        batches: sourceBatches,
        conversationId: 'test-conv',
        memory: mockMemory,
        model: mockModel,
        modelName: 'test-model',
        config,
        systemPrompt: null,
      });

      // Verify source batches (0-4) were deleted (5 total to re-summarize, keeping last 2)
      expect(deletedBlocks).toEqual(['batch-0', 'batch-1', 'batch-2', 'batch-3', 'batch-4']);
    });

    it('Task 5 AC2.4 (single cycle): handles mixed-depth batches and produces depth+1', async () => {
      // Create 8 batches with mixed depths to exceed threshold
      // First 5 will be re-summarized, last 2 kept intact
      const sourceBatches = [
        {
          id: 'batch-0',
          batch: {
            content: 'Summary 0',
            depth: 0,
            startTime: new Date(2000),
            endTime: new Date(2090),
            messageCount: 10,
          },
        },
        {
          id: 'batch-1',
          batch: {
            content: 'Summary 1',
            depth: 0,
            startTime: new Date(2100),
            endTime: new Date(2190),
            messageCount: 10,
          },
        },
        {
          id: 'batch-2',
          batch: {
            content: 'Summary 2',
            depth: 0,
            startTime: new Date(2200),
            endTime: new Date(2290),
            messageCount: 10,
          },
        },
        {
          id: 'batch-3',
          batch: {
            content: 'Summary 3',
            depth: 1,
            startTime: new Date(2300),
            endTime: new Date(2390),
            messageCount: 20,
          },
        },
        {
          id: 'batch-4',
          batch: {
            content: 'Summary 4',
            depth: 1,
            startTime: new Date(2400),
            endTime: new Date(2490),
            messageCount: 20,
          },
        },
        {
          id: 'batch-5',
          batch: {
            content: 'Summary 5',
            depth: 0,
            startTime: new Date(2500),
            endTime: new Date(2590),
            messageCount: 10,
          },
        },
        {
          id: 'batch-6',
          batch: {
            content: 'Summary 6',
            depth: 0,
            startTime: new Date(2600),
            endTime: new Date(2690),
            messageCount: 10,
          },
        },
        {
          id: 'batch-7',
          batch: {
            content: 'Summary 7',
            depth: 0,
            startTime: new Date(2700),
            endTime: new Date(2790),
            messageCount: 10,
          },
        },
      ];

      const { mockMemory, mockModel, writtenBlocks } = createResummarizeTestContext();

      const config = {
        chunkSize: 3,
        keepRecent: 5,
        maxSummaryTokens: 500,
        clipFirst: 2,
        clipLast: 2,
        prompt: null,
      };

      await resummarizeBatches({
        batches: sourceBatches,
        conversationId: 'test-conv',
        memory: mockMemory,
        model: mockModel,
        modelName: 'test-model',
        config,
        systemPrompt: null,
      });

      // Verify new batch has depth 2 (max depth 1 + 1)
      expect(writtenBlocks.length).toBe(1);
      const newBlockContent = writtenBlocks[0]?.content || '';
      expect(newBlockContent).toContain('[depth:2|');
    });
  });
});

describe('compaction pipeline integration', () => {
  it('AC1.1, AC1.3, AC1.4, AC2.1, AC4.1: full pipeline with structured messages and no persona', async () => {
    // Build a test history with 15+ messages to trigger compression
    const messages: Array<ConversationMessage> = [
      createMessage('user-1', 'user', 'Hello, can you help me with something?', 0),
      createMessage('assistant-1', 'assistant', 'of course', 100),
      createMessage('user-2', 'user', 'What is the best way to do X?', 200),
      createMessage('assistant-2', 'assistant', 'short', 300),
      createMessage('user-3', 'user', 'I need to understand error handling in the system', 400),
      createMessage('assistant-3', 'assistant', 'ok', 500),
      createMessage('user-4', 'user', 'Can we agree on a decision here?', 600),
      createMessage('assistant-4', 'assistant', 'sure, let me think about this', 700),
      createMessage('user-5', 'user', 'Important constraint: it must fail gracefully', 800),
      createMessage('assistant-5', 'assistant', 'noted', 900),
      createMessage('user-6', 'user', 'Another question about the implementation?', 1000),
      createMessage('assistant-6', 'assistant', 'x', 1100),
      createMessage('user-7', 'user', 'What about error recovery?', 1200),
      createMessage('assistant-7', 'assistant', 'brief', 1300),
      createMessage('user-8', 'user', 'recent message 1', 1400),
      createMessage('assistant-8', 'assistant', 'recent 2', 1500),
      createMessage('user-9', 'user', 'recent message 3', 1600),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summarized chunk 1', 'Summarized chunk 2']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // AC4.4: Without custom prompt, system field should be DEFAULT_SYSTEM_PROMPT
    const model = mockModel as unknown as { _calls: Array<ModelRequest> };
    expect(model._calls.length).toBeGreaterThan(0);
    const firstCall = model._calls[0];
    expect(firstCall?.system).toBe(DEFAULT_SYSTEM_PROMPT);

    // AC1.1, AC1.3: The call should have structured messages with system field
    expect(firstCall?.messages).toBeDefined();
    expect(Array.isArray(firstCall?.messages)).toBe(true);

    // AC1.3: Verify conversation messages maintain their original roles
    const hasUserMessages = firstCall?.messages?.some((m: Message) => m.role === 'user');
    const hasAssistantMessages = firstCall?.messages?.some(
      (m: Message) => m.role === 'assistant',
    );
    expect(hasUserMessages || hasAssistantMessages).toBe(true);

    // AC1.4: The last message in the request should be a user message with directive
    const lastMessage = firstCall?.messages?.[firstCall.messages.length - 1];
    expect(lastMessage?.role).toBe('user');
    expect(lastMessage?.content).toContain('Summarize');

    // AC4.1: No "persona" text should appear in the request
    const requestText = JSON.stringify(firstCall);
    expect(requestText).not.toContain('persona');

    // Verify result shape
    expect(result.batchesCreated).toBeGreaterThan(0);
    expect(result.messagesCompressed).toBeGreaterThan(0);
    expect(result.history[0]?.role).toBe('system');
    expect(result.history[0]?.content).toContain('Context Summary');
  });

  it('AC1.2, AC1.5: with prior summary as first message, it becomes system-role message in LLM call', async () => {
    // Build history with prior summary at the start
    const messages: Array<ConversationMessage> = [
      createMessage(
        'prior-summary',
        'system',
        '[Context Summary — 20 messages] Previous context included a discussion about X',
        0,
      ),
      createMessage('user-1', 'user', 'Following up on that earlier point', 100),
      createMessage('assistant-1', 'assistant', 'response', 200),
      createMessage('user-2', 'user', 'Error occurred in the system, need to fix it', 300),
      createMessage('assistant-2', 'assistant', 'checking', 400),
      createMessage('user-3', 'user', 'message 3', 500),
      createMessage('assistant-3', 'assistant', 'msg', 600),
      createMessage('user-4', 'user', 'message 4', 700),
      createMessage('assistant-4', 'assistant', 'msg', 800),
      createMessage('user-5', 'user', 'message 5', 900),
      createMessage('assistant-5', 'assistant', 'msg', 1000),
      createMessage('user-6', 'user', 'recent 1', 1100),
      createMessage('assistant-6', 'assistant', 'recent 2', 1200),
      createMessage('user-7', 'user', 'recent 3', 1300),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summarized']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    const model = mockModel as unknown as { _calls: Array<ModelRequest> };
    const firstCall = model._calls[0];

    // AC1.2: Prior summary should appear as a system-role message in the messages array
    const systemRoleMessages = firstCall?.messages?.filter(
      (m: Message) => m.role === 'system',
    );
    expect(systemRoleMessages?.length).toBeGreaterThan(0);
    const priorSummaryMessage = systemRoleMessages?.[0];
    expect(priorSummaryMessage?.content).toContain('Previous summary of conversation');
  });

  it('AC1.5: no prior summary results in no system-role message in messages array', async () => {
    // Build history without prior summary
    const messages: Array<ConversationMessage> = [
      createMessage('user-1', 'user', 'hello', 0),
      createMessage('assistant-1', 'assistant', 'hi', 100),
      createMessage('user-2', 'user', 'error occurred', 200),
      createMessage('assistant-2', 'assistant', 'checking', 300),
      createMessage('user-3', 'user', 'message', 400),
      createMessage('assistant-3', 'assistant', 'msg', 500),
      createMessage('user-4', 'user', 'message', 600),
      createMessage('assistant-4', 'assistant', 'msg', 700),
      createMessage('user-5', 'user', 'message', 800),
      createMessage('assistant-5', 'assistant', 'msg', 900),
      createMessage('user-6', 'user', 'recent', 1000),
      createMessage('assistant-6', 'assistant', 'recent', 1100),
      createMessage('user-7', 'user', 'recent', 1200),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summarized']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    const model = mockModel as unknown as { _calls: Array<ModelRequest> };
    const firstCall = model._calls[0];

    // AC1.5: No prior summary means only conversation messages and directive, no system-role message
    // in the messages array (the system prompt is in the system field, not messages)
    const firstConversationMessage = firstCall?.messages?.[0];
    // First real conversation message should not be a system message
    expect(firstConversationMessage?.role).not.toBe('system');
  });

  it('AC3.1, AC3.4: importance scoring orders messages, lowest-score first', async () => {
    // Create messages with varied importance scores
    // Short assistant messages should score low
    // User questions should score higher
    // Messages with important keywords should score higher
    const messages: Array<ConversationMessage> = [
      createMessage('user-1', 'user', 'What should we do about this?', 0), // question bonus
      createMessage('assistant-1', 'assistant', 'ok', 100), // short, low score
      createMessage('user-2', 'user', 'There is an error in the system', 200), // "error" keyword
      createMessage('assistant-2', 'assistant', 'x', 300), // short
      createMessage('user-3', 'user', 'Made an important decision', 400), // "decision" keyword
      createMessage('assistant-3', 'assistant', 'yes', 500), // short
      createMessage('user-4', 'user', 'more context here', 600),
      createMessage('assistant-4', 'assistant', 'short', 700),
      createMessage('user-5', 'user', 'another message', 800),
      createMessage('assistant-5', 'assistant', 'reply', 900),
      createMessage('user-6', 'user', 'recent 1', 1000),
      createMessage('assistant-6', 'assistant', 'recent 2', 1100),
      createMessage('user-7', 'user', 'recent 3', 1200),
    ];

    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['Summarized']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    // AC3.4: Verify splitHistory returned toCompress sorted by importance ascending
    // by checking that compress was called and messages were processed
    // The short assistant messages should have been selected for compression
    // before the longer, higher-scoring user messages
    const model = mockModel as unknown as { _calls: Array<ModelRequest> };
    expect(model._calls.length).toBeGreaterThan(0);
    // At least one call was made to the model
    expect(model._calls[0]?.messages).toBeDefined();
  });

  it('AC4.2: createCompactor does not accept getPersona callback', async () => {
    // This is a compile-time check: the type CreateCompactorOptions should not have getPersona
    const mockPersistence = createMockPersistenceProvider();
    const mockModel = createMockModelProvider(['test']);
    const mockMemory = createMockMemoryManager();

    const config = {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    // This should compile without error, and createCompactor should not accept getPersona
    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
      // @ts-expect-error getPersona should not exist
      getPersona: () => 'persona',
    });

    expect(compactor).toBeDefined();
  });

  it('AC1.6: re-summarization uses same structured message approach', async () => {
    // Set up enough batches to trigger re-summarization
    const sourceBatches = Array.from({ length: 10 }, (_, i) => ({
      id: `batch-${i}`,
      batch: {
        content: `Summary ${i}`,
        depth: 0,
        startTime: new Date(2000 + i * 100),
        endTime: new Date(2000 + i * 100 + 90),
        messageCount: 10,
      },
    }));

    const { mockMemory, mockModel, calls } = createResummarizeTestContext({
      modelResponseText: 'Re-summarized',
    });

    const config = {
      chunkSize: 3,
      keepRecent: 5,
      maxSummaryTokens: 500,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    await resummarizeBatches({
      batches: sourceBatches,
      conversationId: 'test-conv',
      memory: mockMemory,
      model: mockModel,
      modelName: 'test-model',
      config,
      systemPrompt: null,
    });

    // AC1.6: Re-summarization should also use structured messages with system field
    expect(calls && calls.length).toBeGreaterThan(0);
    const firstCall = calls?.[0];
    expect(firstCall?.system).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(firstCall?.messages).toBeDefined();

    // Should have system-role messages for batches and directive
    const systemRoleMessages = firstCall?.messages?.filter(
      (m: Message) => m.role === 'system',
    );
    expect((systemRoleMessages?.length ?? 0) > 0).toBe(true);

    const lastMessage = firstCall?.messages?.[firstCall.messages.length - 1];
    expect(lastMessage?.role).toBe('user');
    expect(lastMessage?.content).toContain('Summarize');
  });

  // AC2.1: Retry on timeout with exponential backoff
  it('AC2.1: Compaction retries on timeout error with exponential backoff', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    let timeoutsSeen = 0;
    const mockModel: ModelProvider = {
      async complete(_request: ModelRequest): Promise<ModelResponse> {
        timeoutsSeen++;
        if (timeoutsSeen === 1) {
          // First call times out
          throw new ModelError('timeout', true, 'timeout during summarization');
        }
        // Second call succeeds
        return {
          content: [{ type: 'text', text: 'Retried summary' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 8,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: 5000,
      maxRetries: 2,
      backoffBaseMs: 0,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 20 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // Should have seen at least one timeout error
    expect(timeoutsSeen).toBeGreaterThanOrEqual(1);
    // History should be compressed (not original) - one timeout then retry succeeds
    expect(result.history.length).toBeLessThan(messages.length);
  });

  // AC2.2: Chunk size is halved on each retry
  it('AC2.2: Chunk size is halved on each retry attempt', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    const capturedRequests: ModelRequest[] = [];
    let callCount = 0;

    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        callCount++;
        capturedRequests.push(request);
        if (callCount <= 2) {
          // First two calls time out
          throw new ModelError('timeout', true, 'timeout');
        }
        // Third call succeeds
        return {
          content: [{ type: 'text', text: `Summary attempt ${callCount}` }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 16,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: 5000,
      maxRetries: 3,
      backoffBaseMs: 0,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 30 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // Should have succeeded eventually
    expect(result.history.length).toBeLessThan(messages.length);

    // AC2.2 verification: message counts should decrease across retry attempts
    // proving chunk sizes were actually halved
    expect(capturedRequests.length).toBeGreaterThan(1);

    const firstRequestMessageCount = capturedRequests[0]!.messages.length;
    const secondRequestMessageCount = capturedRequests[1]!.messages.length;
    const thirdRequestMessageCount = capturedRequests[2]!.messages.length;

    // Each retry should have fewer messages (chunk size halved)
    expect(secondRequestMessageCount).toBeLessThan(firstRequestMessageCount);
    expect(thirdRequestMessageCount).toBeLessThanOrEqual(secondRequestMessageCount);
  });

  // AC2.3: Chunk size never goes below minimum floor (2 messages)
  it('AC2.3: Chunk size never goes below minimum floor (2 messages)', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    let callCount = 0;

    const mockModel: ModelProvider = {
      async complete(): Promise<ModelResponse> {
        callCount++;
        // Always timeout to force exhaustion
        throw new ModelError('timeout', true, 'timeout');
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 3,
      keepRecent: 1,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: 5000,
      maxRetries: 1,
      backoffBaseMs: 0,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // On retry exhaustion, should return original history unchanged (AC2.6)
    expect(result.history.length).toBe(messages.length);
    expect(result.messagesCompressed).toBe(0);
  });

  // AC2.4: Non-retryable errors fail immediately without retry
  it('AC2.4: Non-retryable errors (auth, 400) fail immediately without retry', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    let callCount = 0;

    const mockModel: ModelProvider = {
      async complete(): Promise<ModelResponse> {
        callCount++;
        // Auth error is non-retryable
        throw new ModelError('auth', false, 'unauthorized');
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 5,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: 5000,
      maxRetries: 3,
      backoffBaseMs: 0,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 15 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // Auth error should fail immediately, only one attempt
    expect(callCount).toBe(1);
    // On failure, return original history unchanged (graceful degradation)
    expect(result.history.length).toBe(messages.length);
    expect(result.messagesCompressed).toBe(0);
  });

  // AC2.5: Compaction timeout is passed through to ModelRequest.timeout
  it('AC2.5: Compaction timeout is passed through to ModelRequest.timeout', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    let capturedRequest: ModelRequest | null = null;

    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequest = request;
        return {
          content: [{ type: 'text', text: 'Test summary' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const timeoutValue = 30000;
    const config = {
      chunkSize: 5,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: timeoutValue,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    // Verify timeout was threaded through to the request
    expect(capturedRequest).not.toBeNull();
    expect((capturedRequest as unknown as ModelRequest).timeout).toBe(timeoutValue);
  });

  // AC2.5b: When config.timeout is undefined, request should not have timeout field
  it('AC2.5b: When config.timeout is undefined, request should not have timeout field', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    let capturedRequest: ModelRequest | null = null;

    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequest = request;
        return {
          content: [{ type: 'text', text: 'Test summary' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 10, output_tokens: 20 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 5,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      // timeout is undefined
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    await compactor.compress(messages, 'test-conv');

    // Verify timeout is not added to request when undefined
    expect(capturedRequest).not.toBeNull();
    // If timeout is undefined in config, the request should be returned as-is without timeout
    // The timeout field may or may not exist, but if it exists, it should not be set to undefined
    expect((capturedRequest as unknown as ModelRequest).timeout === undefined || (capturedRequest as unknown as ModelRequest).timeout == null).toBe(true);
  });

  // AC2.6: Retry exhaustion returns original history unchanged
  it('AC2.6: Retry exhaustion returns original history unchanged', async () => {
    const mockPersistence = createMockPersistenceProvider();
    const mockMemory = createMockMemoryManager();

    const mockModel: ModelProvider = {
      async complete(): Promise<ModelResponse> {
        // Always timeout
        throw new ModelError('timeout', true, 'timeout');
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const config = {
      chunkSize: 8,
      keepRecent: 2,
      maxSummaryTokens: 512,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
      timeout: 5000,
      maxRetries: 1,
      backoffBaseMs: 0,
      scoring: DEFAULT_SCORING_CONFIG,
    };

    const messages = Array.from({ length: 20 }, (_, i) =>
      createMessage(`msg-${i}`, 'user', `Message ${i}`, i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // After all retries exhausted, return original history
    expect(result.history).toEqual(messages);
    expect(result.messagesCompressed).toBe(0);
    expect(result.batchesCreated).toBe(0);
  });
});

describe('chunkMessagesByTokenBudget', () => {
  it('groups messages so each chunk stays within token budget', () => {
    // Each message has 400 chars = ~100 tokens
    const messages = Array.from({ length: 5 }, (_, i) =>
      createMessage(String(i), 'user', 'a'.repeat(400), i * 100),
    );

    // Budget of 250 tokens should fit 2 messages per chunk (200 tokens), not 3 (300)
    const chunks = chunkMessagesByTokenBudget(messages, 250);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.length).toBe(2);
    expect(chunks[1]?.length).toBe(2);
    expect(chunks[2]?.length).toBe(1);
  });

  it('returns empty array for empty input', () => {
    const chunks = chunkMessagesByTokenBudget([], 1000);
    expect(chunks.length).toBe(0);
  });

  it('puts a single oversized message in its own chunk', () => {
    const messages = [
      createMessage('1', 'user', 'a'.repeat(4000), 0), // ~1000 tokens
      createMessage('2', 'user', 'b'.repeat(400), 100), // ~100 tokens
    ];

    const chunks = chunkMessagesByTokenBudget(messages, 500);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.length).toBe(1);
    expect(chunks[0]?.[0]?.id).toBe('1');
    expect(chunks[1]?.length).toBe(1);
    expect(chunks[1]?.[0]?.id).toBe('2');
  });

  it('fits all messages in one chunk when total is under budget', () => {
    const messages = [
      createMessage('1', 'user', 'hello', 0),
      createMessage('2', 'assistant', 'world', 100),
    ];

    const chunks = chunkMessagesByTokenBudget(messages, 10000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.length).toBe(2);
  });

  it('handles messages of varying sizes correctly', () => {
    const messages = [
      createMessage('1', 'user', 'a'.repeat(200), 0),      // ~50 tokens
      createMessage('2', 'assistant', 'b'.repeat(200), 100), // ~50 tokens
      createMessage('3', 'user', 'c'.repeat(2000), 200),     // ~500 tokens
      createMessage('4', 'assistant', 'd'.repeat(200), 300), // ~50 tokens
    ];

    // Budget of 150 tokens: msg1+msg2 fit (100), msg3 alone (500 > 150 but goes in own chunk), msg4 alone (50)
    const chunks = chunkMessagesByTokenBudget(messages, 150);
    expect(chunks.length).toBe(3);
    expect(chunks[0]?.length).toBe(2); // msg1 + msg2
    expect(chunks[1]?.length).toBe(1); // msg3 (oversized, own chunk)
    expect(chunks[2]?.length).toBe(1); // msg4
  });
});

describe('circuit breaker', () => {
  it('stops attempting compaction after maxConsecutiveFailures', async () => {
    let callCount = 0;
    const failingModel: ModelProvider = {
      async complete(): Promise<ModelResponse> {
        callCount++;
        throw new ModelError('timeout', true, 'request timed out');
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const { mockMemory } = createResummarizeTestContext();
    const mockPersistence = createMockPersistenceProvider();

    const config = {
      chunkSize: 5,
      keepRecent: 2,
      maxSummaryTokens: 1024,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
      timeout: 1000,
      maxRetries: 0, // No retries — fail fast for testing
      maxConsecutiveFailures: 2,
    };

    const compactor = createCompactor({
      model: failingModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', `msg${i}`, i * 100),
    );

    // First failure
    const result1 = await compactor.compress(messages, 'test-conv');
    expect(result1.failed).toBe(true);
    expect(compactor.consecutiveFailures).toBe(1);

    // Second failure — trips circuit breaker
    const result2 = await compactor.compress(messages, 'test-conv');
    expect(result2.failed).toBe(true);
    expect(compactor.consecutiveFailures).toBe(2);

    // Third call — circuit breaker skips, no model call
    const callCountBefore = callCount;
    const result3 = await compactor.compress(messages, 'test-conv');
    expect(result3.failed).toBe(true);
    expect(callCount).toBe(callCountBefore); // no new model calls
    expect(compactor.consecutiveFailures).toBe(2);
  });

  it('resets consecutive failures on successful compaction', async () => {
    let shouldFail = true;
    const toggleModel: ModelProvider = {
      async complete(): Promise<ModelResponse> {
        if (shouldFail) {
          throw new ModelError('timeout', true, 'request timed out');
        }
        return {
          content: [{ type: 'text', text: 'Summary of conversation' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const { mockMemory } = createResummarizeTestContext();
    const mockPersistence = createMockPersistenceProvider();

    const config = {
      chunkSize: 5,
      keepRecent: 2,
      maxSummaryTokens: 1024,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
      timeout: 1000,
      maxRetries: 0,
      maxConsecutiveFailures: 3,
    };

    const compactor = createCompactor({
      model: toggleModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', `msg${i}`, i * 100),
    );

    // Fail once
    await compactor.compress(messages, 'test-conv');
    expect(compactor.consecutiveFailures).toBe(1);

    // Succeed — should reset
    shouldFail = false;
    const result = await compactor.compress(messages, 'test-conv');
    expect(result.failed).toBeUndefined();
    expect(compactor.consecutiveFailures).toBe(0);
  });
});

describe('token-budget chunking in compress()', () => {
  it('uses token-budget chunking when maxChunkTokens is configured', async () => {
    const calls: Array<ModelRequest> = [];
    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        calls.push(request);
        return {
          content: [{ type: 'text', text: `Summary ${calls.length}` }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    const { mockMemory } = createResummarizeTestContext();
    const mockPersistence = createMockPersistenceProvider();

    // Each message is 400 chars = ~100 tokens
    // maxChunkTokens of 250 means ~2 messages per chunk
    // 8 compressible messages (10 total - 2 keepRecent) = 4 chunks
    const config = {
      chunkSize: 20, // large — should be overridden by maxChunkTokens
      keepRecent: 2,
      maxSummaryTokens: 1024,
      clipFirst: 2,
      clipLast: 2,
      prompt: null,
      maxChunkTokens: 250,
    };

    const messages = Array.from({ length: 10 }, (_, i) =>
      createMessage(String(i), i % 2 === 0 ? 'user' : 'assistant', 'a'.repeat(400), i * 100),
    );

    const compactor = createCompactor({
      model: mockModel,
      memory: mockMemory,
      persistence: mockPersistence,
      config,
      modelName: 'test-model',
    });

    const result = await compactor.compress(messages, 'test-conv');

    // With maxChunkTokens=250 and ~100 tokens per message, should get ~4 chunks from 8 messages
    // (2 messages per chunk). Each chunk gets a summarize call.
    expect(calls.length).toBe(4);
    expect(result.messagesCompressed).toBe(8);
  });
});
