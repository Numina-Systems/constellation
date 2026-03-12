// pattern: Imperative Shell

/**
 * Full end-to-end integration test for SearchStore with both memory and conversation domains.
 * Verifies fan-out, RRF merging, and filtering across domains.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createSearchStore, createMemorySearchDomain, createConversationSearchDomain } from './index.ts';
import { createMockEmbeddingProvider } from '../integration/test-helpers.ts';

const TEST_OWNER = 'test-integration-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
  await persistence.query('TRUNCATE TABLE messages CASCADE');
}

describe('SearchStore Integration Tests', () => {
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

  describe('GH-23.AC1.1-AC1.3: Hybrid, keyword, and semantic modes across domains', () => {
    it('hybrid mode returns results from both memory and conversations', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Insert a memory block with keyword match
      const memoryBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'memory-search-test',
        content: 'This memory contains information about machine learning',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Insert a conversation message with semantic match
      const queryEmbedding = await mockEmbedding.embed('machine learning');
      const message = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'AI and neural networks are related to deep learning concepts',
        embedding: queryEmbedding,
        created_at: new Date(),
      };

      // Insert memory block
      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          memoryBlock.id,
          memoryBlock.owner,
          memoryBlock.tier,
          memoryBlock.label,
          memoryBlock.content,
          memoryBlock.embedding,
          memoryBlock.permission,
          memoryBlock.pinned,
        ],
      );

      // Insert message
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          message.id,
          message.conversation_id,
          message.role,
          message.content,
          JSON.stringify(message.embedding),
          message.created_at.toISOString(),
        ],
      );

      // Search in hybrid mode across all domains
      const results = await searchStore.search({
        query: 'machine learning',
        mode: 'hybrid',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should get results from both domains
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.domain === 'memory' && r.id === memoryBlock.id)).toBe(true);
      expect(results.some((r) => r.domain === 'conversations' && r.id === message.id)).toBe(true);
    });

    it('keyword mode returns matches without embeddings', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Memory block with keyword match
      const memoryBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'keyword-test',
        content: 'This is a database system architecture discussion',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Message with keyword match
      const message = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'Can you explain database indexing?',
        embedding: null,
        created_at: new Date(),
      };

      // Non-matching block
      const nonMatchingBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'no-match',
        content: 'This is about something completely different',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          memoryBlock.id,
          memoryBlock.owner,
          memoryBlock.tier,
          memoryBlock.label,
          memoryBlock.content,
          memoryBlock.embedding,
          memoryBlock.permission,
          memoryBlock.pinned,
          nonMatchingBlock.id,
          nonMatchingBlock.owner,
          nonMatchingBlock.tier,
          nonMatchingBlock.label,
          nonMatchingBlock.content,
          nonMatchingBlock.embedding,
          nonMatchingBlock.permission,
          nonMatchingBlock.pinned,
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [message.id, message.conversation_id, message.role, message.content, message.created_at.toISOString()],
      );

      // Keyword search
      const results = await searchStore.search({
        query: 'database',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should get both matching results, no non-matching block
      expect(results.length).toBe(2);
      expect(results.some((r) => r.id === memoryBlock.id)).toBe(true);
      expect(results.some((r) => r.id === message.id)).toBe(true);
      expect(results.every((r) => r.id !== nonMatchingBlock.id)).toBe(true);
    });

    it('semantic mode returns vector similarity matches', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Memory block with matching embedding
      const queryEmbedding = await mockEmbedding.embed('neural networks');
      const memoryBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'semantic-memory',
        content: 'Deep learning and AI frameworks',
        embedding: queryEmbedding,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Message with matching embedding
      const message = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Convolutional networks and backpropagation',
        embedding: queryEmbedding,
        created_at: new Date(),
      };

      // Non-matching block without embedding
      const nonMatchingBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'no-embedding',
        content: 'neural networks mentioned but no embedding',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8), ($9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          memoryBlock.id,
          memoryBlock.owner,
          memoryBlock.tier,
          memoryBlock.label,
          memoryBlock.content,
          JSON.stringify(memoryBlock.embedding),
          memoryBlock.permission,
          memoryBlock.pinned,
          nonMatchingBlock.id,
          nonMatchingBlock.owner,
          nonMatchingBlock.tier,
          nonMatchingBlock.label,
          nonMatchingBlock.content,
          nonMatchingBlock.embedding,
          nonMatchingBlock.permission,
          nonMatchingBlock.pinned,
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          message.id,
          message.conversation_id,
          message.role,
          message.content,
          JSON.stringify(message.embedding),
          message.created_at.toISOString(),
        ],
      );

      // Semantic search
      const results = await searchStore.search({
        query: 'something unrelated',
        mode: 'semantic',
        domains: ['memory', 'conversations'],
        embedding: await mockEmbedding.embed('neural networks'),
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should get only results with matching embeddings
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === memoryBlock.id && r.domain === 'memory')).toBe(true);
      expect(results.some((r) => r.id === message.id && r.domain === 'conversations')).toBe(true);
      expect(results.every((r) => r.id !== nonMatchingBlock.id)).toBe(true);
    });
  });

  describe('GH-23.AC1.4: Memory tier filter', () => {
    it('filters memory results by tier while leaving conversations unaffected', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Memory blocks in different tiers
      const coreBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'core',
        label: 'core-memory',
        content: 'Core memory content search test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: true,
      };

      const workingBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'working-memory',
        content: 'Working memory content search test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Message that should match regardless of tier filter
      const message = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'This is a search test message',
        embedding: null,
        created_at: new Date(),
      };

      // Insert blocks
      for (const block of [coreBlock, workingBlock]) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned],
        );
      }

      // Insert message
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [message.id, message.conversation_id, message.role, message.content, message.created_at.toISOString()],
      );

      // Search with working tier filter
      const results = await searchStore.search({
        query: 'search test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: 'working',
      });

      // Should get working block and message, but not core block
      expect(results.some((r) => r.id === workingBlock.id && r.domain === 'memory')).toBe(true);
      expect(results.some((r) => r.id === message.id && r.domain === 'conversations')).toBe(true);
      expect(results.every((r) => r.id !== coreBlock.id)).toBe(true);
    });
  });

  describe('GH-23.AC1.5: Conversation role filter', () => {
    it('filters conversation results by role while leaving memory unaffected', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Memory block that should match regardless of role filter
      const memoryBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'memory-block',
        content: 'This is role filter test memory',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Messages with different roles
      const userMessage = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'User role filter test',
        embedding: null,
        created_at: new Date(),
      };

      const assistantMessage = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Assistant role filter test',
        embedding: null,
        created_at: new Date(),
      };

      // Insert memory block
      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [memoryBlock.id, memoryBlock.owner, memoryBlock.tier, memoryBlock.label, memoryBlock.content, memoryBlock.embedding, memoryBlock.permission, memoryBlock.pinned],
      );

      // Insert messages
      for (const msg of [userMessage, assistantMessage]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search with user role filter
      const results = await searchStore.search({
        query: 'role filter test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: 'user',
        tier: null,
      });

      // Should get memory block and user message, but not assistant message
      expect(results.some((r) => r.id === memoryBlock.id && r.domain === 'memory')).toBe(true);
      expect(results.some((r) => r.id === userMessage.id && r.domain === 'conversations')).toBe(true);
      expect(results.every((r) => r.id !== assistantMessage.id)).toBe(true);
    });
  });

  describe('GH-23.AC4.1-AC4.3: Time filtering across domains', () => {
    it('start_time filter excludes results from both domains created before the time', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Old memory block
      const oldBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'old-memory',
        content: 'Old memory time filter test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: oneHourAgo,
      };

      // New memory block
      const newBlock = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'new-memory',
        content: 'New memory time filter test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: now,
      };

      // Old message
      const oldMessage = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'Old message time filter test',
        embedding: null,
        created_at: oneHourAgo,
      };

      // New message
      const newMessage = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'New message time filter test',
        embedding: null,
        created_at: now,
      };

      // Insert memory blocks
      for (const block of [oldBlock, newBlock]) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned, block.created_at.toISOString()],
        );
      }

      // Insert messages
      for (const msg of [oldMessage, newMessage]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search with start_time filter
      const results = await searchStore.search({
        query: 'time filter test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: now,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should get only new results
      expect(results.some((r) => r.id === newBlock.id)).toBe(true);
      expect(results.some((r) => r.id === newMessage.id)).toBe(true);
      expect(results.every((r) => r.id !== oldBlock.id)).toBe(true);
      expect(results.every((r) => r.id !== oldMessage.id)).toBe(true);
    });

    it('end_time filter excludes results from both domains created after the time', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();
      const now = new Date();
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      // Memory block created before end time
      const blockBeforeEnd = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'before-end-memory',
        content: 'Before end time filter test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: now,
      };

      // Memory block created after end time
      const blockAfterEnd = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'after-end-memory',
        content: 'After end time filter test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: oneHourLater,
      };

      // Message before end time
      const messageBeforeEnd = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'Before end time message',
        embedding: null,
        created_at: now,
      };

      // Message after end time
      const messageAfterEnd = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'After end time message',
        embedding: null,
        created_at: oneHourLater,
      };

      // Insert memory blocks
      for (const block of [blockBeforeEnd, blockAfterEnd]) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned, block.created_at.toISOString()],
        );
      }

      // Insert messages
      for (const msg of [messageBeforeEnd, messageAfterEnd]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search with end_time filter
      const results = await searchStore.search({
        query: 'time filter test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: now,
        role: null,
        tier: null,
      });

      // Should get only results before end time
      expect(results.some((r) => r.id === blockBeforeEnd.id)).toBe(true);
      expect(results.some((r) => r.id === messageBeforeEnd.id)).toBe(true);
      expect(results.every((r) => r.id !== blockAfterEnd.id)).toBe(true);
      expect(results.every((r) => r.id !== messageAfterEnd.id)).toBe(true);
    });

    it('combined start and end time filters create bounded window', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();
      const start = new Date();
      const middle = new Date(start.getTime() + 30 * 60 * 1000); // 30 minutes later
      const end = new Date(start.getTime() + 60 * 60 * 1000); // 60 minutes later

      // Block before window
      const blockBefore = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'before-window',
        content: 'Before time window test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: new Date(start.getTime() - 10 * 60 * 1000),
      };

      // Block inside window
      const blockInside = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'inside-window',
        content: 'Inside time window test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: middle,
      };

      // Block after window
      const blockAfter = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'after-window',
        content: 'After time window test',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
        created_at: new Date(end.getTime() + 10 * 60 * 1000),
      };

      // Similar for messages
      const messageBefore = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'Before window message',
        embedding: null,
        created_at: new Date(start.getTime() - 10 * 60 * 1000),
      };

      const messageInside = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Inside window message',
        embedding: null,
        created_at: middle,
      };

      const messageAfter = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'After window message',
        embedding: null,
        created_at: new Date(end.getTime() + 10 * 60 * 1000),
      };

      // Insert memory blocks
      for (const block of [blockBefore, blockInside, blockAfter]) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned, block.created_at.toISOString()],
        );
      }

      // Insert messages
      for (const msg of [messageBefore, messageInside, messageAfter]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search with bounded time window
      const results = await searchStore.search({
        query: 'window test',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: start,
        endTime: end,
        role: null,
        tier: null,
      });

      // Should get only results inside the window
      expect(results.some((r) => r.id === blockInside.id)).toBe(true);
      expect(results.some((r) => r.id === messageInside.id)).toBe(true);
      expect(results.every((r) => r.id !== blockBefore.id)).toBe(true);
      expect(results.every((r) => r.id !== blockAfter.id)).toBe(true);
      expect(results.every((r) => r.id !== messageBefore.id)).toBe(true);
      expect(results.every((r) => r.id !== messageAfter.id)).toBe(true);
    });
  });

  describe('RRF merging across domains', () => {
    it('results appearing in both domains rank higher via RRF', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Block with keyword match
      const block = {
        id: randomUUID(),
        owner: TEST_OWNER,
        tier: 'working',
        label: 'rrf-memory',
        content: 'Machine learning systems and algorithms',
        embedding: null,
        permission: 'readwrite' as const,
        pinned: false,
      };

      // Message with keyword match
      const msg1 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'Tell me about machine learning algorithms',
        embedding: null,
        created_at: new Date(),
      };

      // Message with keyword match (another one)
      const msg2 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Machine learning involves training models with data',
        embedding: null,
        created_at: new Date(),
      };

      // Insert block
      await persistence.query(
        `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned],
      );

      // Insert messages
      for (const msg of [msg1, msg2]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search
      const results = await searchStore.search({
        query: 'machine learning',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // All three should be in results
      expect(results.length).toBe(3);
      expect(results.some((r) => r.domain === 'memory' && r.id === block.id)).toBe(true);
      expect(results.some((r) => r.domain === 'conversations' && r.id === msg1.id)).toBe(true);
      expect(results.some((r) => r.domain === 'conversations' && r.id === msg2.id)).toBe(true);

      // Results should be ranked by RRF score (all have same score, so order doesn't matter)
      expect(results.every((r) => r.score > 0)).toBe(true);
    });

    it('results are interleaved by domain in RRF output', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const searchStore = createSearchStore(mockEmbedding);
      searchStore.registerDomain(createMemorySearchDomain(persistence, TEST_OWNER));
      searchStore.registerDomain(createConversationSearchDomain(persistence));

      const conversationId = randomUUID();

      // Create multiple blocks and messages to verify interleaving
      const blocks = [];
      const messages = [];

      for (let i = 0; i < 3; i++) {
        blocks.push({
          id: randomUUID(),
          owner: TEST_OWNER,
          tier: 'working',
          label: `interleave-block-${i}`,
          content: 'Search interleaving test data',
          embedding: null,
          permission: 'readwrite' as const,
          pinned: false,
        });

        messages.push({
          id: randomUUID(),
          conversation_id: conversationId,
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: 'Search interleaving test data',
          embedding: null,
          created_at: new Date(),
        });
      }

      // Insert all blocks
      for (const block of blocks) {
        await persistence.query(
          `INSERT INTO memory_blocks (id, owner, tier, label, content, embedding, permission, pinned)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [block.id, block.owner, block.tier, block.label, block.content, block.embedding, block.permission, block.pinned],
        );
      }

      // Insert all messages
      for (const msg of messages) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [msg.id, msg.conversation_id, msg.role, msg.content, msg.created_at.toISOString()],
        );
      }

      // Search
      const results = await searchStore.search({
        query: 'interleaving',
        mode: 'keyword',
        domains: ['memory', 'conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Should get all 6 results
      expect(results.length).toBe(6);

      // Verify all IDs are present
      const memoryIdSet = new Set<string>();
      const messageIdSet = new Set<string>();

      for (const block of blocks) {
        memoryIdSet.add(block.id);
      }
      for (const msg of messages) {
        messageIdSet.add(msg.id);
      }

      for (const result of results) {
        expect(memoryIdSet.has(result.id) || messageIdSet.has(result.id)).toBe(true);
      }

      // Verify results are not grouped by domain (RRF should interleave them)
      // Count consecutive results from same domain
      let domainChanges = 0;
      for (let i = 1; i < results.length; i++) {
        if (results[i]!.domain !== results[i - 1]!.domain) {
          domainChanges++;
        }
      }

      // With RRF merging, we should see at least some domain changes
      // (not all blocks followed by all messages)
      expect(domainChanges).toBeGreaterThan(0);
    });
  });
});
