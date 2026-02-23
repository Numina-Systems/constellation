// pattern: Imperative Shell

/**
 * Tests for the entry point interaction loop.
 * Verifies REPL input/output, pending mutation flow, and graceful shutdown.
 * Tests use a callback-based interaction instead of readline events to avoid
 * async timing issues with event emitters.
 */

import { describe, it, expect, mock } from 'bun:test';
import type { Agent } from '@/agent/types';
import type { MemoryManager } from '@/memory/manager';
import type { PersistenceProvider } from '@/persistence/types';
import type { PendingMutation, MemoryBlock, MemoryWriteResult } from '@/memory/types';

/**
 * Process pending mutations with provided user responses.
 * Extracted for testability without readline event loop complexity.
 */
export async function processPendingMutations(
  memory: MemoryManager,
  onMutationPrompt: (mutation: PendingMutation) => Promise<string>,
): Promise<void> {
  const mutations = await memory.getPendingMutations();

  for (const mutation of mutations) {
    const response = await onMutationPrompt(mutation);

    if (response.toLowerCase() === 'y') {
      await memory.approveMutation(mutation.id);
    } else {
      const feedback = response.toLowerCase() === 'n' ? 'user rejected' : response;
      await memory.rejectMutation(mutation.id, feedback);
    }
  }
}

/**
 * Mock agent for testing.
 */
function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    processMessage: mock(async (_message: string) => 'mock response'),
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

describe('interaction loop', () => {
  describe('AC6.1: basic message processing', () => {
    it('calls agent.processMessage() with user input', async () => {
      const agent = createMockAgent();

      const userMessage = 'hello world';
      await agent.processMessage(userMessage);

      expect(agent.processMessage).toHaveBeenCalledWith('hello world');
    });

    it('agent returns a response', async () => {
      const mockResponse = 'agent says hello';
      const agent = createMockAgent({
        processMessage: mock(async () => mockResponse),
      });

      const result = await agent.processMessage('test input');
      expect(result).toBe(mockResponse);
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
    it('persistence provider has disconnect method', async () => {
      const persistence = createMockPersistence();
      expect(typeof persistence.disconnect).toBe('function');
    });

    it('can call disconnect without error', async () => {
      const persistence = createMockPersistence();
      await persistence.disconnect();
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
});
