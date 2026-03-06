// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createPostgresProvider } from '../../persistence/postgres.ts';
import { createConversationSearchDomain } from './conversations.ts';
import { createMockEmbeddingProvider } from '../../integration/test-helpers.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE messages CASCADE');
}

describe('Conversation Search Domain', () => {
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

  describe('GH-23.AC1.1: Hybrid mode returns both keyword and vector matches', () => {
    it('returns messages matching both keyword query and semantic embedding', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      // Insert a message with exact keyword match
      const msgWithKeyword = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'This is about machine learning algorithms',
        created_at: new Date(),
      };

      // Insert a message with similar embedding but different keywords
      const queryEmbedding = await mockEmbedding.embed('machine learning');
      const msgWithEmbedding = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'AI models and neural networks for deep learning',
        embedding: queryEmbedding,
        created_at: new Date(),
      };

      // Insert both messages
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msgWithKeyword.id,
          msgWithKeyword.conversation_id,
          msgWithKeyword.role,
          msgWithKeyword.content,
          msgWithKeyword.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          msgWithEmbedding.id,
          msgWithEmbedding.conversation_id,
          msgWithEmbedding.role,
          msgWithEmbedding.content,
          JSON.stringify(msgWithEmbedding.embedding),
          msgWithEmbedding.created_at.toISOString(),
        ],
      );

      const embedding = await mockEmbedding.embed('machine learning');
      const results = await domain.search({
        query: 'machine learning',
        mode: 'hybrid',
        domains: ['conversations'],
        embedding: embedding,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === msgWithKeyword.id)).toBe(true);
      expect(results.some((r) => r.id === msgWithEmbedding.id)).toBe(true);
      expect(results[0]?.domain).toBe('conversations');
    });
  });

  describe('GH-23.AC1.2: Keyword mode without embedding', () => {
    it('returns only keyword matches without needing embedding', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      // Insert messages
      const msg1 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'This content contains the word database',
        created_at: new Date(),
      };

      const msg2 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'This is unrelated content',
        created_at: new Date(),
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg1.id,
          msg1.conversation_id,
          msg1.role,
          msg1.content,
          msg1.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg2.id,
          msg2.conversation_id,
          msg2.role,
          msg2.content,
          msg2.created_at.toISOString(),
        ],
      );

      const results = await domain.search({
        query: 'database',
        mode: 'keyword',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(msg1.id);
      expect(results[0]?.content).toContain('database');
    });
  });

  describe('GH-23.AC1.3: Semantic mode returns vector similarity matches', () => {
    it('returns messages by embedding similarity without text matching', async () => {
      const mockEmbedding = createMockEmbeddingProvider();
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      // Message with similar embedding but no keyword match
      const queryEmbedding = await mockEmbedding.embed('neural networks');
      const msg1 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'Deep learning frameworks and AI systems',
        embedding: queryEmbedding,
        created_at: new Date(),
      };

      // Message without embedding (should not be returned)
      const msg2 = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'neural networks everywhere in the world',
        created_at: new Date(),
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, embedding, created_at)
         VALUES ($1, $2, $3, $4, $5::vector, $6)`,
        [
          msg1.id,
          msg1.conversation_id,
          msg1.role,
          msg1.content,
          JSON.stringify(msg1.embedding),
          msg1.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg2.id,
          msg2.conversation_id,
          msg2.role,
          msg2.content,
          msg2.created_at.toISOString(),
        ],
      );

      const embedding = await mockEmbedding.embed('neural networks');
      const results = await domain.search({
        query: 'something unrelated',
        mode: 'semantic',
        domains: ['conversations'],
        embedding: embedding,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      // Only message with embedding should be returned
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.id === msg1.id)).toBe(true);
      expect(results.every((r) => r.id !== msg2.id)).toBe(true);
    });
  });

  describe('GH-23.AC1.5: Role filter respects role parameter', () => {
    it('returns only messages matching the specified role', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      // Insert messages with different roles
      const userMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'user message with database keyword',
        created_at: new Date(),
      };

      const assistantMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'assistant message with database keyword',
        created_at: new Date(),
      };

      const systemMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'system',
        content: 'system message with database keyword',
        created_at: new Date(),
      };

      const toolMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'tool',
        content: 'tool message with database keyword',
        created_at: new Date(),
      };

      for (const msg of [userMsg, assistantMsg, systemMsg, toolMsg]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            msg.id,
            msg.conversation_id,
            msg.role,
            msg.content,
            msg.created_at.toISOString(),
          ],
        );
      }

      // Search for assistant role only
      const results = await domain.search({
        query: 'database',
        mode: 'keyword',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: 'assistant',
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(assistantMsg.id);
      expect(results[0]?.metadata.role).toBe('assistant');
    });
  });

  describe('GH-23.AC4.1: Start time filter excludes earlier messages', () => {
    it('excludes messages created before startTime', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Message created in the past
      const oldMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'old message with memory keyword',
        created_at: oneHourAgo,
      };

      // Message created now
      const newMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'new message with memory keyword',
        created_at: now,
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          oldMsg.id,
          oldMsg.conversation_id,
          oldMsg.role,
          oldMsg.content,
          oldMsg.created_at.toISOString(),
        ],
      );

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          newMsg.id,
          newMsg.conversation_id,
          newMsg.role,
          newMsg.content,
          newMsg.created_at.toISOString(),
        ],
      );

      const results = await domain.search({
        query: 'memory',
        mode: 'keyword',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: now,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      expect(results[0]?.id).toBe(newMsg.id);
    });
  });

  describe('GH-23.AC4.3: Time window filter (start + end)', () => {
    it('returns only messages within the bounded time window', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneHourLater = new Date(now.getTime() + 60 * 60 * 1000);

      // Message created in the past
      const oldMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'old message with conversation keyword',
        created_at: oneHourAgo,
      };

      // Message created within window
      const windowMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'window message with conversation keyword',
        created_at: now,
      };

      // Message created in the future
      const futureMsg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'system',
        content: 'future message with conversation keyword',
        created_at: oneHourLater,
      };

      for (const msg of [oldMsg, windowMsg, futureMsg]) {
        await persistence.query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            msg.id,
            msg.conversation_id,
            msg.role,
            msg.content,
            msg.created_at.toISOString(),
          ],
        );
      }

      // Search with time window
      const results = await domain.search({
        query: 'conversation',
        mode: 'keyword',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: oneHourAgo,
        endTime: oneHourLater,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(3);
      expect(results.some((r) => r.id === oldMsg.id)).toBe(true);
      expect(results.some((r) => r.id === windowMsg.id)).toBe(true);
      expect(results.some((r) => r.id === futureMsg.id)).toBe(true);
    });
  });

  describe('Edge case: Null embedding handling', () => {
    it('semantic mode throws error when embedding is null', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      const msg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'test content',
        created_at: new Date(),
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg.id,
          msg.conversation_id,
          msg.role,
          msg.content,
          msg.created_at.toISOString(),
        ],
      );

      try {
        await domain.search({
          query: 'test',
          mode: 'semantic',
          domains: ['conversations'],
          embedding: null,
          limit: 10,
          startTime: null,
          endTime: null,
          role: null,
          tier: null,
        });
        expect.unreachable('should have thrown an error');
      } catch (err) {
        expect((err as Error).message).toContain('Semantic search requires an embedding');
      }
    });

    it('hybrid mode degrades to keyword-only when embedding is null', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      // Insert keyword-matchable message
      const msg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'assistant',
        content: 'This message contains database keywords',
        created_at: new Date(),
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg.id,
          msg.conversation_id,
          msg.role,
          msg.content,
          msg.created_at.toISOString(),
        ],
      );

      // Search in hybrid mode with null embedding should fall back to keyword-only
      const results = await domain.search({
        query: 'database',
        mode: 'hybrid',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.id).toBe(msg.id);
      expect(results[0]?.content).toContain('database');
    });
  });

  describe('Metadata mapping', () => {
    it('maps result metadata correctly with conversationId and role', async () => {
      const domain = createConversationSearchDomain(persistence);
      const conversationId = randomUUID();

      const msg = {
        id: randomUUID(),
        conversation_id: conversationId,
        role: 'user',
        content: 'test message with keyword',
        created_at: new Date(),
      };

      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          msg.id,
          msg.conversation_id,
          msg.role,
          msg.content,
          msg.created_at.toISOString(),
        ],
      );

      const results = await domain.search({
        query: 'test',
        mode: 'keyword',
        domains: ['conversations'],
        embedding: null,
        limit: 10,
        startTime: null,
        endTime: null,
        role: null,
        tier: null,
      });

      expect(results.length).toBe(1);
      const result = results[0];
      expect(result?.metadata.conversationId).toBe(conversationId);
      expect(result?.metadata.role).toBe('user');
      expect(result?.metadata.tier).toBeNull();
      expect(result?.metadata.label).toBeNull();
      expect(result?.domain).toBe('conversations');
    });
  });
});
