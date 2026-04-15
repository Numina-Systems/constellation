// pattern: Imperative Shell

/**
 * Integration tests for subconscious agent instance.
 * Verifies conversation isolation, independent compaction, and cold-start behavior.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '@/persistence/postgres';
import { createPostgresMemoryStore } from '@/memory/postgres-store';
import { createMemoryManager } from '@/memory/manager';
import { createToolRegistry } from '@/tool/registry';
import { createDenoExecutor } from '@/runtime/executor';
import { createAgent } from '@/agent/agent';
import { createMockEmbeddingProvider } from '@/integration/test-helpers';
import { createCompactor } from '@/compaction';
import type { ModelProvider, ModelResponse, ModelRequest, StreamEvent } from '@/model/types';
import type { CompactionConfig } from '@/compaction/types';
import { randomUUID } from 'crypto';

const DB_CONNECTION_STRING = 'postgresql://constellation:constellation@localhost:5432/constellation';
const TEST_OWNER = 'subconscious-test-' + Math.random().toString(36).substring(7);

let persistence: ReturnType<typeof createPostgresProvider>;
let mockEmbedding = createMockEmbeddingProvider();

/**
 * Create a mock model provider that returns simple text responses.
 */
function createMockModelProvider(): ModelProvider {
  let callCount = 0;
  return {
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      callCount++;
      return {
        content: [{ type: 'text', text: `response-${callCount}` }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 10 },
      };
    },
    async *stream(): AsyncIterable<StreamEvent> {
      yield {
        type: 'message_stop',
        message: { stop_reason: 'end_turn' },
      };
    },
  };
}

/**
 * Create a test Deno runtime with standard config.
 */
function createTestRuntime(registry: ReturnType<typeof createToolRegistry>) {
  return createDenoExecutor(
    {
      max_code_size: 10000,
      max_output_size: 10000,
      code_timeout: 5000,
      working_dir: '/tmp',
      unrestricted: false,
      allowed_hosts: [],
      allowed_read_paths: [],
      allowed_write_paths: [],
      allowed_run: [],
      max_tool_rounds: 5,
      context_budget: 100000,
      max_context_tokens: 200000,
      max_tool_calls_per_exec: 25,
    },
    registry,
  );
}

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE pending_mutations CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE messages CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

describe('SubconsciousAgent', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC2.1: Subconscious agent maintains dedicated conversation with stable ID', () => {
    it('creates two agents with different conversation IDs and verifies isolation', async () => {
      const mainConversationId = randomUUID();
      const subconsciousConversationId = randomUUID();

      const memory = createMemoryManager(
        createPostgresMemoryStore(persistence),
        mockEmbedding,
        TEST_OWNER,
      );

      const registry = createToolRegistry();
      const runtime = createTestRuntime(registry);
      const mockModel = createMockModelProvider();

      const mainAgent = createAgent({
        model: mockModel,
        memory,
        registry,
        runtime,
        persistence,
        embedding: mockEmbedding,
        config: {
          max_tool_rounds: 5,
          context_budget: 100000,
          model_max_tokens: 200000,
          model_name: 'test-model',
        },
      }, mainConversationId);

      const subconsciousAgent = createAgent({
        model: mockModel,
        memory,
        registry,
        runtime,
        persistence,
        embedding: mockEmbedding,
        config: {
          max_tool_rounds: 5,
          context_budget: 100000,
          model_max_tokens: 200000,
          model_name: 'test-model',
        },
      }, subconsciousConversationId);

      expect(mainAgent.conversationId).toBe(mainConversationId);
      expect(subconsciousAgent.conversationId).toBe(subconsciousConversationId);
      expect(mainAgent.conversationId).not.toBe(subconsciousAgent.conversationId);

      // Process a message through each agent
      await mainAgent.processMessage('Hello from main');
      await subconsciousAgent.processMessage('Hello from subconscious');

      // Verify messages are stored under separate conversation IDs
      const mainHistory = await persistence.query<{ conversation_id: string }>(
        'SELECT DISTINCT conversation_id FROM messages WHERE conversation_id = $1',
        [mainConversationId],
      );
      expect(mainHistory.length).toBeGreaterThan(0);
      expect(mainHistory[0]?.conversation_id).toBe(mainConversationId);

      const subconsciousHistory = await persistence.query<{ conversation_id: string }>(
        'SELECT DISTINCT conversation_id FROM messages WHERE conversation_id = $1',
        [subconsciousConversationId],
      );
      expect(subconsciousHistory.length).toBeGreaterThan(0);
      expect(subconsciousHistory[0]?.conversation_id).toBe(subconsciousConversationId);
    });
  });

  describe('AC2.2: Inner conversation compacts independently from main conversation', () => {
    it('compacts one agent conversation and verifies the other is unchanged', async () => {
      const mainConversationId = randomUUID();
      const subconsciousConversationId = randomUUID();

      const memory = createMemoryManager(
        createPostgresMemoryStore(persistence),
        mockEmbedding,
        TEST_OWNER,
      );

      const registry = createToolRegistry();
      const runtime = createTestRuntime(registry);
      const mockModel = createMockModelProvider();

      const mainAgent = createAgent({
        model: mockModel,
        memory,
        registry,
        runtime,
        persistence,
        embedding: mockEmbedding,
        config: {
          max_tool_rounds: 5,
          context_budget: 100000,
          model_max_tokens: 200000,
          model_name: 'test-model',
        },
      }, mainConversationId);

      const subconsciousAgent = createAgent({
        model: mockModel,
        memory,
        registry,
        runtime,
        persistence,
        embedding: mockEmbedding,
        config: {
          max_tool_rounds: 5,
          context_budget: 100000,
          model_max_tokens: 200000,
          model_name: 'test-model',
        },
      }, subconsciousConversationId);

      // Add 5 messages to main agent
      for (let i = 0; i < 5; i++) {
        await mainAgent.processMessage(`Main message ${i + 1}`);
      }

      // Add 3 messages to subconscious agent
      for (let i = 0; i < 3; i++) {
        await subconsciousAgent.processMessage(`Subconscious message ${i + 1}`);
      }

      // Get history lengths before compaction
      const mainHistoryBeforeCompaction = await mainAgent.getConversationHistory();
      const subconsciousHistoryBeforeCompaction = await subconsciousAgent.getConversationHistory();
      const mainHistoryLengthBefore = mainHistoryBeforeCompaction.length;
      const subconsciousHistoryLengthBefore = subconsciousHistoryBeforeCompaction.length;

      expect(mainHistoryLengthBefore).toBeGreaterThan(0);
      expect(subconsciousHistoryLengthBefore).toBeGreaterThan(0);

      // Create compactor and compact the main agent's conversation
      const compactionConfig: CompactionConfig = {
        chunkSize: 2,
        keepRecent: 1,
        maxSummaryTokens: 256,
        clipFirst: 1,
        clipLast: 1,
        prompt: null,
      };

      const compactor = createCompactor({
        model: mockModel,
        memory,
        persistence,
        config: compactionConfig,
        modelName: 'test-model',
      });

      // Compact the main agent's conversation
      await compactor.compress(mainHistoryBeforeCompaction, mainConversationId);

      // Get history after compacting main agent
      const mainHistoryAfterCompaction = await mainAgent.getConversationHistory();
      const subconsciousHistoryAfterCompaction = await subconsciousAgent.getConversationHistory();

      // Main agent's history may change (but should still have content)
      expect(mainHistoryAfterCompaction.length).toBeGreaterThan(0);

      // Subconscious agent's history length should be UNCHANGED
      expect(subconsciousHistoryAfterCompaction.length).toBe(subconsciousHistoryLengthBefore);

      // Verify the subconscious history content is still intact
      const subconsciousMessagesText = subconsciousHistoryAfterCompaction.map(m => m.content || '').join(' ');
      expect(subconsciousMessagesText).toContain('Subconscious message');
    });
  });

  describe('AC2.3: On first startup with no prior inner conversation, agent starts fresh with empty history', () => {
    it('creates agent with fresh conversation ID and verifies cold-start behavior', async () => {
      const freshConversationId = randomUUID();

      const memory = createMemoryManager(
        createPostgresMemoryStore(persistence),
        mockEmbedding,
        TEST_OWNER,
      );

      const registry = createToolRegistry();
      const runtime = createTestRuntime(registry);
      const mockModel = createMockModelProvider();

      // Create agent with fresh conversation ID
      const agent = createAgent({
        model: mockModel,
        memory,
        registry,
        runtime,
        persistence,
        embedding: mockEmbedding,
        config: {
          max_tool_rounds: 5,
          context_budget: 100000,
          model_max_tokens: 200000,
          model_name: 'test-model',
        },
      }, freshConversationId);

      // Verify conversation history is empty before processing any messages
      let history = await agent.getConversationHistory();
      expect(history).toHaveLength(0);

      // Process an event through the agent
      const response = await agent.processMessage('First message');
      expect(response).toBeTruthy();

      // Verify conversation history now contains messages
      history = await agent.getConversationHistory();
      expect(history.length).toBeGreaterThan(0);

      // Verify the message was persisted under the correct conversation ID
      const dbMessages = await persistence.query<{ conversation_id: string }>(
        'SELECT DISTINCT conversation_id FROM messages WHERE conversation_id = $1',
        [freshConversationId],
      );
      expect(dbMessages.length).toBe(1);
      expect(dbMessages[0]?.conversation_id).toBe(freshConversationId);
    });
  });
});
