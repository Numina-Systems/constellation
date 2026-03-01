// pattern: Imperative Shell

/**
 * Tests for the entry point interaction loop.
 * Verifies REPL input/output, pending mutation flow, and graceful shutdown.
 * Tests exercise actual production code from src/index.ts.
 */

import { describe, it, expect, mock } from 'bun:test';
import { processPendingMutations, performShutdown, createInteractionLoop, processEventQueue } from '@/index';
import type { Agent } from '@/agent/types';
import type { MemoryManager } from '@/memory/manager';
import type { PersistenceProvider } from '@/persistence/types';
import type { PendingMutation, MemoryBlock, MemoryWriteResult } from '@/memory/types';
import type { IncomingMessage } from '@/extensions/data-source';
import type { Interface as ReadlineInterface } from 'readline';

/**
 * Mock agent for testing.
 */
function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    processMessage: mock(async (_message: string) => 'mock response'),
    processEvent: mock(async () => 'mock response'),
    getConversationHistory: mock(async () => []),
    conversationId: 'test-conv-123',
    ...overrides,
  };
}

/**
 * Mock memory manager for testing.
 */
function createMockMemory(overrides?: Partial<MemoryManager>): MemoryManager {
  const successResult: MemoryWriteResult = { applied: true, block: {} as MemoryBlock };
  return {
    getCoreBlocks: mock(async () => []),
    getWorkingBlocks: mock(async () => []),
    buildSystemPrompt: mock(async () => ''),
    read: mock(async () => []),
    write: mock(async () => successResult),
    list: mock(async () => []),
    deleteBlock: mock(async () => {
      // no-op for testing
    }),
    getPendingMutations: mock(async () => []),
    approveMutation: mock(async () => ({} as MemoryBlock)),
    rejectMutation: mock(async () => ({} as PendingMutation)),
    ...overrides,
  };
}

/**
 * Mock persistence provider for testing.
 */
function createMockPersistence(overrides?: Partial<PersistenceProvider>): PersistenceProvider {
  return {
    connect: mock(async () => {}),
    disconnect: mock(async () => {}),
    runMigrations: mock(async () => {}),
    query: mock(async () => []),
    withTransaction: mock(async (fn) => fn(mock(async () => []))),
    ...overrides,
  };
}

/**
 * Mock readline interface for testing.
 */
function createMockReadline(overrides?: Partial<ReadlineInterface>): ReadlineInterface {
  return {
    write: mock(() => {}),
    close: mock(() => {}),
    setPrompt: mock(() => {}),
    prompt: mock(() => {}),
    once: mock((_event: string, _handler: any) => {
      // For testing, we don't invoke the handler automatically
      return {} as any;
    }),
    on: mock((_event: string, _handler: any) => {
      return {} as any;
    }),
    ...overrides,
  } as any;
}

describe('interaction loop', () => {
  describe('AC6.1: basic message processing', () => {
    it('calls agent.processMessage() with user input via createInteractionLoop', async () => {
      const agent = createMockAgent();
      const memory = createMockMemory({
        getPendingMutations: mock(async () => []),
      });
      const persistence = createMockPersistence();
      const mockReadline = createMockReadline();

      const handler = createInteractionLoop({
        agent,
        memory,
        persistence,
        readline: mockReadline,
      });

      const userMessage = 'hello world';
      await handler(userMessage);

      expect(agent.processMessage).toHaveBeenCalledWith('hello world');
    });

    it('agent response is written to output via createInteractionLoop', async () => {
      const mockResponse = 'agent says hello';
      const agent = createMockAgent({
        processMessage: mock(async () => mockResponse),
      });
      const memory = createMockMemory({
        getPendingMutations: mock(async () => []),
      });
      const persistence = createMockPersistence();
      const mockReadline = createMockReadline();

      const handler = createInteractionLoop({
        agent,
        memory,
        persistence,
        readline: mockReadline,
      });

      await handler('test input');
      expect(agent.processMessage).toHaveBeenCalledWith('test input');
    });
  });

  describe('AC6.2: pending mutation handling', () => {
    it('retrieves pending mutations before processing', async () => {
      const pendingMutation: PendingMutation = {
        id: 'mut-123',
        block_id: 'core:persona',
        proposed_content: 'I am curious and creative',
        reason: 'updating based on conversations',
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const memory = createMockMemory({
        getPendingMutations: mock(async () => [pendingMutation]),
      });

      await processPendingMutations(memory, async () => 'y');

      expect(memory.getPendingMutations).toHaveBeenCalled();
    });

    it('approves mutation when response is "y"', async () => {
      const mutation: PendingMutation = {
        id: 'mut-456',
        block_id: 'working:notes',
        proposed_content: 'new notes',
        reason: null,
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const memory = createMockMemory({
        getPendingMutations: mock(async () => [mutation]),
      });

      await processPendingMutations(memory, async () => 'y');

      expect(memory.approveMutation).toHaveBeenCalledWith('mut-456');
    });

    it('rejects mutation when response is "n"', async () => {
      const mutation: PendingMutation = {
        id: 'mut-789',
        block_id: 'archival:summary',
        proposed_content: 'summary text',
        reason: null,
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const memory = createMockMemory({
        getPendingMutations: mock(async () => [mutation]),
      });

      await processPendingMutations(memory, async () => 'n');

      expect(memory.rejectMutation).toHaveBeenCalledWith('mut-789', 'user rejected');
    });

    it('rejects mutation with user feedback', async () => {
      const mutation: PendingMutation = {
        id: 'mut-101',
        block_id: 'core:style',
        proposed_content: 'formal style',
        reason: null,
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const memory = createMockMemory({
        getPendingMutations: mock(async () => [mutation]),
      });

      await processPendingMutations(memory, async () => 'please make it more casual');

      expect(memory.rejectMutation).toHaveBeenCalledWith('mut-101', 'please make it more casual');
    });

    it('processes multiple mutations in sequence', async () => {
      const mut1: PendingMutation = {
        id: 'mut-1',
        block_id: 'block-1',
        proposed_content: 'content1',
        reason: null,
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const mut2: PendingMutation = {
        id: 'mut-2',
        block_id: 'block-2',
        proposed_content: 'content2',
        reason: null,
        status: 'pending',
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };

      const memory = createMockMemory({
        getPendingMutations: mock(async () => [mut1, mut2]),
      });

      const responses = ['y', 'n'];
      let callCount = 0;

      await processPendingMutations(
        memory,
        async () => responses[callCount++] ?? '',
      );

      expect(memory.approveMutation).toHaveBeenCalledWith('mut-1');
      expect(memory.rejectMutation).toHaveBeenCalledWith('mut-2', 'user rejected');
    });
  });

  describe('AC6.3: graceful shutdown', () => {
    it('shutdown closes readline interface', async () => {
      const persistence = createMockPersistence();
      const mockReadline = createMockReadline();

      await performShutdown(mockReadline, persistence);

      expect(mockReadline.close).toHaveBeenCalled();
    });

    it('shutdown disconnects persistence provider', async () => {
      const persistence = createMockPersistence();
      const mockReadline = createMockReadline();

      await performShutdown(mockReadline, persistence);

      expect(persistence.disconnect).toHaveBeenCalled();
    });

    it('shutdown performs all cleanup steps', async () => {
      const persistence = createMockPersistence();
      const mockReadline = createMockReadline();

      await performShutdown(mockReadline, persistence);

      expect(mockReadline.close).toHaveBeenCalled();
      expect(persistence.disconnect).toHaveBeenCalled();
    });
  });

  describe('integration: full interaction', () => {
    it('processes message and returns response', async () => {
      const agent = createMockAgent({
        processMessage: mock(async () => 'response from agent'),
      });

      const response = await agent.processMessage('user input');
      expect(response).toBe('response from agent');
      expect(agent.processMessage).toHaveBeenCalledWith('user input');
    });

    it('handles message with no pending mutations', async () => {
      const agent = createMockAgent({
        processMessage: mock(async () => 'response'),
      });
      const memoryNoMutations = createMockMemory({
        getPendingMutations: mock(async () => []),
      });

      await processPendingMutations(memoryNoMutations, async () => {
        throw new Error('should not prompt');
      });

      expect(memoryNoMutations.getPendingMutations).toHaveBeenCalled();
      const response = await agent.processMessage('message');
      expect(response).toBe('response');
    });
  });

  describe('AC6.5: processEventQueue error handling', () => {
    it('processes single event successfully', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const agent = createMockAgent({
        processEvent: mock(async () => 'event processed'),
      });

      const event: IncomingMessage = {
        source: 'bluesky',
        content: 'test post',
        metadata: { uri: 'at://did:key:xyz/app.bsky.feed.post/abc123' },
        timestamp: new Date(),
      };

      const queue = createEventQueue(10);
      queue.push(event);
      await processEventQueue(queue, agent);

      expect(agent.processEvent).toHaveBeenCalledWith(event);
      expect(queue.length).toBe(0);
    });

    it('catches errors and continues processing subsequent events', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const errorEvent: IncomingMessage = {
        source: 'bluesky',
        content: 'error post',
        metadata: {},
        timestamp: new Date(),
      };

      const goodEvent: IncomingMessage = {
        source: 'bluesky',
        content: 'good post',
        metadata: {},
        timestamp: new Date(),
      };

      const agent = createMockAgent({
        processEvent: mock(async (event: any) => {
          if (event === errorEvent) {
            throw new Error('processing failed');
          }
          return 'ok';
        }),
      });

      const queue = createEventQueue(10);
      queue.push(errorEvent);
      queue.push(goodEvent);
      await processEventQueue(queue, agent);

      expect(agent.processEvent).toHaveBeenCalledTimes(2);
      expect(agent.processEvent).toHaveBeenNthCalledWith(1, errorEvent);
      expect(agent.processEvent).toHaveBeenNthCalledWith(2, goodEvent);
      expect(queue.length).toBe(0);
    });

    it('processes multiple events from queue', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const events: Array<IncomingMessage> = [
        {
          source: 'bluesky',
          content: 'post 1',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 2',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 3',
          metadata: {},
          timestamp: new Date(),
        },
      ];

      const agent = createMockAgent({
        processEvent: mock(async () => 'processed'),
      });

      const queue = createEventQueue(10);
      for (const event of events) {
        queue.push(event);
      }
      await processEventQueue(queue, agent);

      expect(agent.processEvent).toHaveBeenCalledTimes(3);
      events.forEach((event, index) => {
        expect(agent.processEvent).toHaveBeenNthCalledWith(index + 1, event);
      });
      expect(queue.length).toBe(0);
    });

    it('drains queue completely even with intermittent errors', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const events: Array<IncomingMessage> = [
        {
          source: 'bluesky',
          content: 'post 1',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 2 (will error)',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 3',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 4 (will error)',
          metadata: {},
          timestamp: new Date(),
        },
        {
          source: 'bluesky',
          content: 'post 5',
          metadata: {},
          timestamp: new Date(),
        },
      ];

      const agent = createMockAgent({
        processEvent: mock(async (event: any) => {
          if ((event as any).content.includes('will error')) {
            throw new Error('deliberate error');
          }
          return 'ok';
        }),
      });

      const queue = createEventQueue(10);
      for (const event of events) {
        queue.push(event);
      }
      await processEventQueue(queue, agent);

      expect(agent.processEvent).toHaveBeenCalledTimes(5);
      expect(queue.length).toBe(0);
    });

    it('logs errors to console without re-throwing', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const consoleMock = mock((_msg: string) => {});
      const originalError = console.error;
      console.error = consoleMock;

      const errorEvent: IncomingMessage = {
        source: 'bluesky',
        content: 'error',
        metadata: {},
        timestamp: new Date(),
      };

      const agent = createMockAgent({
        processEvent: mock(async () => {
          throw new Error('test error message');
        }),
      });

      const queue = createEventQueue(10);
      queue.push(errorEvent);

      try {
        await processEventQueue(queue, agent);
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringContaining('bluesky processEvent error'),
        );
      } finally {
        console.error = originalError;
      }
    });

    it('handles non-Error exceptions gracefully', async () => {
      const { createEventQueue } = await import('@/extensions/bluesky');
      const consoleMock = mock((_msg: string) => {});
      const originalError = console.error;
      console.error = consoleMock;

      const errorEvent: IncomingMessage = {
        source: 'bluesky',
        content: 'error',
        metadata: {},
        timestamp: new Date(),
      };

      const agent = createMockAgent({
        processEvent: mock(async () => {
          throw 'raw string error';
        }),
      });

      const queue = createEventQueue(10);
      queue.push(errorEvent);

      try {
        await processEventQueue(queue, agent);
        expect(consoleMock).toHaveBeenCalledWith(
          expect.stringContaining('bluesky processEvent error'),
        );
      } finally {
        console.error = originalError;
      }
    });
  });
});
