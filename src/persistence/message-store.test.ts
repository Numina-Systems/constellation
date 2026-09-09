import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from './postgres.ts';
import { createMessageStore } from './message-store.ts';
import {createTestDatabase, teardownTestDatabase, type TestDatabase} from '@/testing/test-database.ts';

let database: TestDatabase;
let persistence: ReturnType<typeof createPostgresProvider>;
let store: ReturnType<typeof createMessageStore>;

let messageCounter = 0;

async function insertMessage(
  conversationId: string,
  role: string,
  content: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await persistence.query(
    `INSERT INTO messages (id, conversation_id, role, content, created_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' seconds')::interval)`,
    [id, conversationId, role, content, messageCounter++],
  );
  return id;
}

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE messages CASCADE');
}

describe('arch-hardening.AC4: MessageStore interface', () => {
  beforeAll(async () => {
    database = await createTestDatabase();
    persistence = database.persistence as ReturnType<typeof createPostgresProvider>;
    await cleanupTables();

    store = createMessageStore(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    if (database) await teardownTestDatabase(database);
  });

  describe('arch-hardening.AC4.1: count() returns accurate message count', () => {
    it('returns 0 for nonexistent conversation', async () => {
      const count = await store.count('nonexistent-conv-id');
      expect(count).toBe(0);
    });

    it('returns correct count for conversation A and B independently', async () => {
      await insertMessage('conv-a', 'user', 'Message 1');
      await insertMessage('conv-a', 'assistant', 'Response 1');
      await insertMessage('conv-a', 'user', 'Message 2');

      await insertMessage('conv-b', 'user', 'Message 1');
      await insertMessage('conv-b', 'assistant', 'Response 1');

      const countA = await store.count('conv-a');
      const countB = await store.count('conv-b');
      const countNonexistent = await store.count('nonexistent');

      expect(countA).toBe(3);
      expect(countB).toBe(2);
      expect(countNonexistent).toBe(0);
    });
  });

  describe('arch-hardening.AC4.2: listIds() returns all IDs ordered by creation time', () => {
    it('returns empty array for nonexistent conversation', async () => {
      const ids = await store.listIds('nonexistent-conv-id');
      expect(ids).toHaveLength(0);
    });

    it('returns all IDs in ascending created_at order', async () => {
      const id1 = await insertMessage('conv-test', 'user', 'Message 1');
      const id2 = await insertMessage('conv-test', 'assistant', 'Response 1');
      const id3 = await insertMessage('conv-test', 'user', 'Message 2');

      const ids = await store.listIds('conv-test');

      expect(ids).toHaveLength(3);
      expect(ids[0]).toBe(id1);
      expect(ids[1]).toBe(id2);
      expect(ids[2]).toBe(id3);
    });

    it('returns only messages for the specified conversation', async () => {
      const idA1 = await insertMessage('conv-a', 'user', 'Message A1');
      const idA2 = await insertMessage('conv-a', 'assistant', 'Response A1');

      await insertMessage('conv-b', 'user', 'Message B1');
      await insertMessage('conv-b', 'assistant', 'Response B1');

      const idsA = await store.listIds('conv-a');
      const idsB = await store.listIds('conv-b');

      expect(idsA).toHaveLength(2);
      expect(idsA[0]).toBe(idA1);
      expect(idsA[1]).toBe(idA2);

      expect(idsB).toHaveLength(2);
    });
  });

  describe('arch-hardening.AC4.3: getLatest() returns N most recent messages as ConversationMessage[]', () => {
    it('returns empty array for nonexistent conversation', async () => {
      const messages = await store.getLatest('nonexistent-conv-id', 10);
      expect(messages).toHaveLength(0);
    });

    it('returns 3 most recent messages in reverse chronological order (most recent first)', async () => {
      await insertMessage('conv-test', 'user', 'Message 1');
      await insertMessage('conv-test', 'assistant', 'Response 1');
      const id3 = await insertMessage('conv-test', 'user', 'Message 2');
      const id4 = await insertMessage('conv-test', 'assistant', 'Response 2');
      const id5 = await insertMessage('conv-test', 'user', 'Message 3');

      const latest = await store.getLatest('conv-test', 3);

      expect(latest).toHaveLength(3);

      // Most recent first
      expect(latest[0]?.id).toBe(id5);
      expect(latest[0]?.conversation_id).toBe('conv-test');
      expect(latest[0]?.role).toBe('user');
      expect(latest[0]?.content).toBe('Message 3');
      expect(latest[0]?.created_at).toBeInstanceOf(Date);

      expect(latest[1]?.id).toBe(id4);
      expect(latest[1]?.role).toBe('assistant');

      expect(latest[2]?.id).toBe(id3);
      expect(latest[2]?.role).toBe('user');
    });

    it('gracefully returns all messages when limit exceeds count', async () => {
      const id1 = await insertMessage('conv-test', 'user', 'Message 1');
      const id2 = await insertMessage('conv-test', 'assistant', 'Response 1');
      const id3 = await insertMessage('conv-test', 'user', 'Message 2');

      const latest = await store.getLatest('conv-test', 10);

      expect(latest).toHaveLength(3);
      expect(latest[0]?.id).toBe(id3);
      expect(latest[1]?.id).toBe(id2);
      expect(latest[2]?.id).toBe(id1);
    });

    it('returns messages with all fields populated', async () => {
      // Insert a message with tool_calls and reasoning_content
      const id = crypto.randomUUID();
      const toolCalls = [{id: 'call-1', function: 'test', args: {}}];
      const reasoningContent = 'I think therefore I am';
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW() + ($8 || ' seconds')::interval)`,
        [
          id,
          'conv-test',
          'assistant',
          'Thinking hard',
          JSON.stringify(toolCalls),
          'call-1',
          reasoningContent,
          messageCounter++,
        ],
      );

      const latest = await store.getLatest('conv-test', 1);

      expect(latest).toHaveLength(1);
      const msg = latest[0];
      expect(msg?.id).toBe(id);
      expect(msg?.conversation_id).toBe('conv-test');
      expect(msg?.role).toBe('assistant');
      expect(msg?.content).toBe('Thinking hard');
      expect(msg?.tool_calls).toEqual(toolCalls);
      expect(msg?.tool_call_id).toBe('call-1');
      expect(msg?.reasoning_content).toBe(reasoningContent);
      expect(msg?.created_at).toBeInstanceOf(Date);
    });

    it('handles null optional fields correctly', async () => {
      const id = crypto.randomUUID();
      await persistence.query(
        `INSERT INTO messages (id, conversation_id, role, content, tool_calls, tool_call_id, reasoning_content, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 || ' seconds')::interval)`,
        [id, 'conv-test', 'user', 'Simple message', null, null, null, messageCounter++],
      );

      const latest = await store.getLatest('conv-test', 1);

      expect(latest).toHaveLength(1);
      const msg = latest[0];
      expect(msg?.tool_calls).toBeUndefined();
      expect(msg?.tool_call_id).toBeUndefined();
      expect(msg?.reasoning_content).toBeNull();
    });
  });

  describe('MessageStore participates in transactions', () => {
    it('count() sees uncommitted rows inside withTransaction', async () => {
      const conversationId = 'tx-test-conv';

      // Count before transaction
      const countBefore = await store.count(conversationId);
      expect(countBefore).toBe(0);

      // Inside transaction, insert and count
      await persistence.withTransaction(async (query) => {
        // Insert using the transaction query function
        const id = crypto.randomUUID();
        await query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [id, conversationId, 'user', 'Test message'],
        );

        // Count inside same transaction should see the inserted row
        const countInside = await store.count(conversationId);
        expect(countInside).toBe(1);
      });

      // After transaction commits, count should still show the row
      const countAfter = await store.count(conversationId);
      expect(countAfter).toBe(1);
    });

    it('getLatest() sees uncommitted rows inside withTransaction', async () => {
      const conversationId = 'tx-test-conv-2';

      await persistence.withTransaction(async (query) => {
        const id = crypto.randomUUID();
        await query(
          `INSERT INTO messages (id, conversation_id, role, content, created_at)
           VALUES ($1, $2, $3, $4, NOW())`,
          [id, conversationId, 'user', 'Transaction message'],
        );

        // Get latest inside same transaction should see the inserted row
        const latest = await store.getLatest(conversationId, 10);
        expect(latest).toHaveLength(1);
        expect(latest[0]?.content).toBe('Transaction message');
      });

      // After transaction commits, getLatest should still show the message
      const latest = await store.getLatest(conversationId, 10);
      expect(latest).toHaveLength(1);
    });
  });
});
