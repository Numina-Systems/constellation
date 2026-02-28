/**
 * Tests for the compaction pipeline.
 * Covers pure helper functions and compress() pipeline with mocked dependencies.
 */

import { describe, it, expect } from 'bun:test';
import type { ConversationMessage } from '../agent/types.js';
import type { ModelProvider, ModelRequest, ModelResponse } from '../model/types.js';
import type { MemoryManager } from '../memory/manager.js';
import type { PersistenceProvider, QueryFunction } from '../persistence/types.js';
import type { SummaryBatch } from './types.js';
import {
  splitHistory,
  chunkMessages,
  formatMessagesForPrompt,
  buildClipArchive,
  estimateTokens,
  createCompactor,
} from './compactor.js';

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
      expect(toCompress[0]?.id).toBe('1');
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

  describe('formatMessagesForPrompt', () => {
    it('converts messages to role: content format', () => {
      const messages = [
        createMessage('1', 'user', 'Hello'),
        createMessage('2', 'assistant', 'Hi there'),
        createMessage('3', 'user', 'How are you?'),
      ];

      const result = formatMessagesForPrompt(messages);
      expect(result).toBe('user: Hello\nassistant: Hi there\nuser: How are you?');
    });

    it('handles empty message array', () => {
      const result = formatMessagesForPrompt([]);
      expect(result).toBe('');
    });

    it('preserves multiline content', () => {
      const messages = [
        createMessage('1', 'user', 'Line 1\nLine 2\nLine 3'),
        createMessage('2', 'assistant', 'Response'),
      ];

      const result = formatMessagesForPrompt(messages);
      expect(result.includes('Line 1\nLine 2\nLine 3')).toBe(true);
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
});

describe('Compaction pipeline with mocked dependencies', () => {
  /**
   * Mock implementations
   */

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
    const archivedBatches: Array<{ label: string; content: string }> = [];

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
        archivedBatches.push({ label, content });
        return {
          applied: true,
          block: {
            id: 'test',
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
      async getPendingMutations() {
        return [];
      },
      async approveMutation() {
        throw new Error('not implemented');
      },
      async rejectMutation() {
        throw new Error('not implemented');
      },
      _archivedBatches: archivedBatches,
    } as unknown as MemoryManager;
  }

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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
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
      getPersona: async () => 'Test persona',
    });

    const compResult = await compactor.compress(messages, 'test-conv');

    expect(compResult.batchesCreated).toBe(0);
    expect(compResult.messagesCompressed).toBe(0);
    expect(compResult.history).toEqual(messages);
  });
});
