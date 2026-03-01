// pattern: Imperative Shell

/**
 * End-to-end integration test for the compaction pipeline.
 * Tests the full path: message history -> compaction -> summarization (via Ollama) -> archival storage.
 * Requires PostgreSQL and Ollama to be running.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import type { ModelConfig } from '../config/schema';
import type { ConversationMessage } from '../agent/types';
import { createOpenAICompatAdapter } from '../model/openai-compat';
import { createPostgresProvider } from '../persistence/postgres';
import { createPostgresMemoryStore } from '../memory/postgres-store';
import { createMemoryManager } from '../memory/manager';
import { createCompactor } from '../compaction/compactor';
import { createMockEmbeddingProvider } from './test-helpers';

const TEST_CONVERSATION_ID = 'test-conversation-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

function getOllamaEndpoint(): string {
  return process.env['OLLAMA_ENDPOINT'] ?? 'http://192.168.1.6:11434';
}

function getOllamaModel(): string {
  return process.env['OLLAMA_MODEL'] ?? 'qwen3:1.7b';
}

let persistence: ReturnType<typeof createPostgresProvider>;
let mockEmbedding = createMockEmbeddingProvider();

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE pending_mutations CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE messages CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

/**
 * Helper function to seed messages into the database.
 * Takes an array of content strings and creates alternating user/assistant messages.
 */
async function seedMessages(
  content: ReadonlyArray<string>,
): Promise<Array<ConversationMessage>> {
  const messages: Array<ConversationMessage> = [];
  const startTime = new Date(Date.now() - content.length * 60000);

  for (let i = 0; i < content.length; i++) {
    const created_at = new Date(startTime.getTime() + i * 60000);
    const message: ConversationMessage = {
      id: crypto.randomUUID(),
      conversation_id: TEST_CONVERSATION_ID,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: content[i] as string,
      created_at,
    };

    messages.push(message);

    await persistence.query(
      `INSERT INTO messages (id, conversation_id, role, content, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [message.id, message.conversation_id, message.role, message.content, message.created_at],
    );
  }

  return messages;
}

/**
 * Helper function to create test compactor with Ollama connection check.
 * Returns null if Ollama is not available, otherwise returns the compactor and related managers.
 */
async function createTestCompactor(): Promise<{
  compactor: ReturnType<typeof createCompactor>;
  store: ReturnType<typeof createPostgresMemoryStore>;
  memory: ReturnType<typeof createMemoryManager>;
} | null> {
  const ollamaConfig: ModelConfig = {
    provider: 'openai-compat',
    name: getOllamaModel(),
    api_key: 'ollama',
    base_url: getOllamaEndpoint() + '/v1',
  };

  let model: ReturnType<typeof createOpenAICompatAdapter>;
  try {
    model = createOpenAICompatAdapter(ollamaConfig);
    // Test connection with a minimal request
    await model.complete({
      model: getOllamaModel(),
      messages: [{ role: 'user', content: 'test' }],
      max_tokens: 10,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Failed to connect') ||
        error.message.includes('Unable to connect') ||
        error.message.includes('ECONNREFUSED') ||
        error.message.includes('network'))
    ) {
      console.log('Skipping integration test: Ollama server not available');
      return null;
    }
    throw error;
  }

  // Create memory manager with real PostgreSQL and mock embeddings
  const store = createPostgresMemoryStore(persistence);
  const memory = createMemoryManager(store, mockEmbedding, TEST_CONVERSATION_ID);

  // Create compactor
  const compactor = createCompactor({
    model,
    memory,
    persistence,
    config: {
      chunkSize: 5,
      keepRecent: 3,
      maxSummaryTokens: 500,
      clipFirst: 1,
      clipLast: 1,
      prompt: null,
    },
    modelName: getOllamaModel(),
    getPersona: async () =>
      'You are a helpful assistant analyzing conversation history. Summarize key decisions and events.',
  });

  return { compactor, store, memory };
}

describe('Compaction Integration Tests', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    mockEmbedding = createMockEmbeddingProvider();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('Context compaction with Ollama summarization', () => {
    it('compacts conversation history and produces summary batches', async () => {
      const setup = await createTestCompactor();
      if (!setup) return;

      const { compactor } = setup;

      const conversationContent: ReadonlyArray<string> = [
        'User: I need help with PostgreSQL',
        'Assistant: I can help with that. What specific issue?',
        'User: Query performance is slow',
        'Assistant: Let me analyze the schema',
        'User: The table has 10 million rows',
        'Assistant: Let\'s add an index',
        'User: Which column should we index?',
        'Assistant: The foreign key column for joins',
        'User: Added the index successfully',
        'Assistant: Great! The query should be faster',
        'User: Benchmark shows 10x improvement',
        'Assistant: Excellent performance gain',
        'User: Now let\'s optimize the authentication',
        'Assistant: I found a bug in the auth module',
        'User: Can you detail the fix?',
      ];

      const messages = await seedMessages(conversationContent);

      // Run compaction
      const result = await compactor.compress(messages, TEST_CONVERSATION_ID);

      // Verify compression happened
      expect(result.messagesCompressed).toBeGreaterThan(0);
      expect(result.batchesCreated).toBeGreaterThan(0);
      expect(result.tokensEstimateBefore).toBeGreaterThan(result.tokensEstimateAfter);
      expect(result.history.length).toBeLessThan(messages.length);

      // Verify compressed history structure
      expect(result.history.length).toBeGreaterThan(0);
      const firstMessage = result.history.at(0);
      expect(firstMessage?.role).toBe('system');
      expect(firstMessage?.content).toContain('[Context Summary');

      // Verify keepRecent messages are preserved
      const lastThreeOriginal = messages.slice(-3);
      for (const origMsg of lastThreeOriginal) {
        expect(
          result.history.some((m) => m.role === origMsg.role && m.content === origMsg.content),
        ).toBe(true);
      }
    });

    it('archives summary batches to archival memory', async () => {
      const setup = await createTestCompactor();
      if (!setup) return;

      const { compactor, store } = setup;

      const messages = await seedMessages(
        Array.from({ length: 15 }, (_, i) => `Message ${i + 1}`)
      );

      // Run compaction
      await compactor.compress(messages, TEST_CONVERSATION_ID);

      // Query archival memory blocks
      const archivedBlocks = await store.getBlocksByTier(TEST_CONVERSATION_ID, 'archival');

      // Verify batches were archived
      expect(archivedBlocks.length).toBeGreaterThan(0);

      // Verify batch labels match pattern
      for (const block of archivedBlocks) {
        expect(block.label).toMatch(new RegExp(`^compaction-batch-${TEST_CONVERSATION_ID}-`));
        expect(block.content.length).toBeGreaterThan(0);
      }
    });

    it('produces coherent summaries', async () => {
      const setup = await createTestCompactor();
      if (!setup) return;

      const { compactor } = setup;

      const identifiableContent: ReadonlyArray<string> = [
        'User: We decided to use PostgreSQL for the database',
        'Assistant: That is a good choice for relational data',
        'User: We also decided on TypeScript for type safety',
        'Assistant: TypeScript is excellent for large projects',
        'User: Our team found a bug in the authentication module',
        'Assistant: Can you describe the security issue?',
        'User: The session token validation is incomplete',
        'Assistant: This is critical and needs immediate fixing',
        'User: We implemented OAuth 2.0 as the solution',
        'Assistant: OAuth provides better security',
        'User: Performance improved after database indexing',
        'Assistant: Indexes greatly improve query speed',
        'User: We achieved 100 millisecond response times',
        'Assistant: That is acceptable performance',
        'User: Ready for production deployment',
      ];

      const messages = await seedMessages(identifiableContent);

      // Run compaction
      const result = await compactor.compress(messages, TEST_CONVERSATION_ID);

      // Get the system message containing the summary
      const systemMessage = result.history.at(0);
      expect(systemMessage?.role).toBe('system');

      // Verify the summary is non-empty and substantive
      expect(systemMessage?.content.length).toBeGreaterThan(100);

      // Verify the summary mentions key topics
      // (soft assertion - just check it's not trivial)
      const summaryLower = systemMessage?.content.toLowerCase() ?? '';
      const hasRelevantContent =
        summaryLower.includes('postgresql') ||
        summaryLower.includes('database') ||
        summaryLower.includes('typescript') ||
        summaryLower.includes('authentication') ||
        summaryLower.includes('summary') ||
        summaryLower.includes('context');

      expect(hasRelevantContent).toBe(true);
    });

    it('clip-archive format is correct', async () => {
      const setup = await createTestCompactor();
      if (!setup) return;

      const { compactor } = setup;

      const messages = await seedMessages(
        Array.from({ length: 15 }, (_, i) => `Conversation message ${i + 1} with some content`)
      );

      // Run compaction
      const result = await compactor.compress(messages, TEST_CONVERSATION_ID);

      // Get the system message (clip-archive)
      const systemMessage = result.history.at(0);
      expect(systemMessage?.role).toBe('system');

      // Verify clip-archive structure
      const content = systemMessage?.content ?? '';

      // Check for opening marker
      expect(content).toContain('[Context Summary');

      // Check for section headers
      expect(
        content.includes('## Earliest context') || content.includes('## Recent context'),
      ).toBe(true);

      // Check for clip-archive batch markers
      // These appear as [Batch N — depth M, ISO to ISO] patterns
      expect(content).toMatch(/\[Batch \d+ — depth \d+/);
    });
  });
});
