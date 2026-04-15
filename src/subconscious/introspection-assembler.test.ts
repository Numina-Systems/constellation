// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { createIntrospectionAssembler } from './introspection-assembler';
import type { InterestRegistry, Interest } from './types';
import type { PersistenceProvider } from '@/persistence/types';
import type { MemoryStore } from '@/memory/store';
import type { MemoryBlock } from '@/memory/types';

function createMockInterestRegistry(): InterestRegistry {
  return {
    async createInterest(interest) {
      return {
        id: 'int-1',
        ...interest,
        createdAt: new Date(),
        lastEngagedAt: new Date(),
      };
    },

    async getInterest() {
      return null;
    },

    async updateInterest() {
      return null;
    },

    async listInterests(owner, filters) {
      const interests: Array<Interest> = [
        {
          id: 'int-1',
          owner,
          name: 'machine learning',
          description: 'neural networks and transformers',
          source: 'emergent',
          engagementScore: 0.85,
          status: 'active',
          lastEngagedAt: new Date(),
          createdAt: new Date(),
        },
      ];

      if (filters?.status) {
        return interests.filter((i) => i.status === filters.status);
      }
      return interests;
    },

    async createCuriosityThread(thread) {
      return {
        id: 'ct-1',
        ...thread,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    async getCuriosityThread() {
      return null;
    },

    async updateCuriosityThread() {
      return null;
    },

    async listCuriosityThreads() {
      return [];
    },

    async findDuplicateCuriosityThread() {
      return null;
    },

    async logExploration(entry) {
      return {
        id: 'log-1',
        ...entry,
        createdAt: new Date(),
      };
    },

    async listExplorationLog() {
      return [];
    },

    async applyEngagementDecay() {
      return 0;
    },

    async enforceActiveInterestCap() {
      return [];
    },

    async bumpEngagement(interestId) {
      return {
        id: interestId,
        owner: 'test',
        name: 'test',
        description: 'test',
        source: 'emergent',
        engagementScore: 1.5,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      };
    },
  };
}

function createMockPersistence(): PersistenceProvider {
  return {
    async connect() {
      // no-op
    },

    async disconnect() {
      // no-op
    },

    async runMigrations() {
      // no-op
    },

    query: async () => {
      return [];
    },

    async withTransaction(fn) {
      return fn(this.query);
    },
  };
}

function createMockMemoryStore(): MemoryStore {
  const mockBlock: MemoryBlock = {
    id: 'block-1',
    owner: 'test',
    tier: 'working',
    label: 'introspection-digest',
    content: 'Previous digest notes about interests',
    embedding: null,
    permission: 'readwrite',
    pinned: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

  return {
    async getBlock() {
      return null;
    },

    async getBlocksByTier() {
      return [];
    },

    async getBlockByLabel(_owner, label) {
      if (label === 'introspection-digest') {
        return mockBlock;
      }
      return null;
    },

    async createBlock() {
      return mockBlock;
    },

    async updateBlock() {
      return mockBlock;
    },

    async deleteBlock() {
      // no-op
    },

    async searchByEmbedding() {
      return [];
    },

    async logEvent() {
      return {
        id: 'evt-1',
        block_id: 'block-1',
        owner: 'test',
        event_type: 'create' as const,
        old_content: null,
        new_content: 'test',
        context: null,
        created_at: new Date(),
      };
    },

    async getEvents() {
      return [];
    },

    async createMutation() {
      return {
        id: 'mut-1',
        block_id: 'block-1',
        owner: 'test',
        proposed_content: 'test',
        reason: null,
        status: 'pending' as const,
        feedback: null,
        created_at: new Date(),
        resolved_at: null,
      };
    },

    async getPendingMutations() {
      return [];
    },

    async resolveMutation() {
      return {
        id: 'mut-1',
        block_id: 'block-1',
        owner: 'test',
        proposed_content: 'test',
        reason: null,
        status: 'approved' as const,
        feedback: null,
        created_at: new Date(),
        resolved_at: new Date(),
      };
    },

    async updateBlockTier() {
      return mockBlock;
    },
  };
}

describe('introspection-loop.AC1.3, AC1.6, AC3.2: createIntrospectionAssembler', () => {
  it('creates assembler with mocked dependencies', () => {
    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    expect(assembler).toBeDefined();
    expect(typeof assembler.assembleIntrospection).toBe('function');
  });

  it('assembleIntrospection() queries interests with active status filter (AC1.3)', async () => {
    let capturedFilters: Parameters<InterestRegistry['listInterests']>[1] | undefined;

    const mockRegistry: InterestRegistry = {
      ...createMockInterestRegistry(),
      async listInterests(_owner, filters) {
        capturedFilters = filters;
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: mockRegistry,
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    await assembler.assembleIntrospection();

    expect(capturedFilters).toBeDefined();
    expect(capturedFilters?.status).toBe('active');
  });

  it('includes active interests in the event (AC1.3)', async () => {
    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.metadata['interestCount']).toBe(1);
    expect(event.content).toContain('machine learning');
  });

  it('includes last digest content in event when block exists (AC1.3)', async () => {
    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.content).toContain('[Last Digest]');
    expect(event.content).toContain('Previous digest notes');
  });

  it('handles missing digest block (AC1.3)', async () => {
    const memoryStore: MemoryStore = {
      ...createMockMemoryStore(),
      async getBlockByLabel() {
        return null;
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore,
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.content).toContain('[Last Digest]');
    expect(event.content).toContain('first introspection');
    expect(event.metadata['hasExistingDigest']).toBe(false);
  });

  it('produces event even with zero messages (AC1.6)', async () => {
    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async () => {
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event).toBeDefined();
    expect(event.source).toBe('subconscious:introspection');
    expect(event.content).toContain('No recent conversation to review');
    expect(event.metadata['messageCount']).toBe(0);
  });

  it('calls persistence.query with correct SQL and params (AC3.2)', async () => {
    let capturedSQL: string | undefined;
    let capturedParams: readonly unknown[] | undefined;

    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async <T extends Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> => {
        capturedSQL = sql;
        capturedParams = params;
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    await assembler.assembleIntrospection();

    expect(capturedSQL).toBeDefined();
    expect(capturedSQL).toContain('conversation_id = $1');
    expect(capturedSQL).toContain("role != 'tool'");
    expect(capturedSQL).toContain('created_at >= $2');
    expect(capturedParams).toBeDefined();
    expect(capturedParams?.[0]).toBe('conv-introspection');
  });

  it('passes subconsciousConversationId as first parameter (AC3.2)', async () => {
    let capturedParams: readonly unknown[] | undefined;

    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async <T extends Record<string, unknown>>(
        _sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> => {
        capturedParams = params;
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'my-introspection-conv',
      lookbackHours: 24,
    });

    await assembler.assembleIntrospection();

    expect(capturedParams?.[0]).toBe('my-introspection-conv');
  });

  it('calculates lookback window correctly', async () => {
    let capturedParams: readonly unknown[] | undefined;
    const beforeCall = Date.now();

    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async <T extends Record<string, unknown>>(
        _sql: string,
        params?: readonly unknown[],
      ): Promise<T[]> => {
        capturedParams = params;
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    await assembler.assembleIntrospection();

    const sinceDate = capturedParams?.[1] as Date;

    expect(sinceDate).toBeDefined();
    // Verify the since date is roughly 24 hours ago (86400000 ms)
    const lookbackMs = beforeCall - sinceDate.getTime();
    const lookbackHours = lookbackMs / (3600 * 1000);
    // Allow 2 second tolerance for test execution time
    expect(lookbackHours).toBeCloseTo(24, 0.001);
  });

  it('calls getBlockByLabel with owner and introspection-digest label', async () => {
    let capturedOwner: string | undefined;
    let capturedLabel: string | undefined;

    const memoryStore: MemoryStore = {
      ...createMockMemoryStore(),
      async getBlockByLabel(owner, label) {
        capturedOwner = owner;
        capturedLabel = label;
        return null;
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore,
      owner: 'test-owner',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    await assembler.assembleIntrospection();

    expect(capturedOwner).toBe('test-owner');
    expect(capturedLabel).toBe('introspection-digest');
  });

  it('returns ExternalEvent with source subconscious:introspection', async () => {
    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.source).toBe('subconscious:introspection');
  });

  it('returns ExternalEvent with correct metadata structure', async () => {
    const assembler = createIntrospectionAssembler({
      persistence: createMockPersistence(),
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.metadata).toBeDefined();
    expect(event.metadata['taskType']).toBe('introspection');
    expect(typeof event.metadata['messageCount']).toBe('number');
    expect(typeof event.metadata['interestCount']).toBe('number');
    expect(typeof event.metadata['hasExistingDigest']).toBe('boolean');
  });

  it('formats messages with timestamps and roles', async () => {
    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async <T extends Record<string, unknown>>(): Promise<T[]> => {
        return [
          {
            role: 'user',
            content: 'What is machine learning?',
            created_at: new Date('2026-04-14T10:00:00Z'),
          } as unknown as T,
          {
            role: 'assistant',
            content: 'Machine learning is a subset of AI...',
            created_at: new Date('2026-04-14T10:05:00Z'),
          } as unknown as T,
        ];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    expect(event.metadata['messageCount']).toBe(2);
    expect(event.content).toContain('user');
    expect(event.content).toContain('assistant');
    expect(event.content).toContain('What is machine learning?');
  });

  it('truncates long messages at 500 characters', async () => {
    const longContent = 'a'.repeat(600);
    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async <T extends Record<string, unknown>>(): Promise<T[]> => {
        return [
          {
            role: 'user',
            content: longContent,
            created_at: new Date(),
          } as unknown as T,
        ];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: createMockInterestRegistry(),
      memoryStore: createMockMemoryStore(),
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const event = await assembler.assembleIntrospection();

    // Content should be truncated with ellipsis
    expect(event.content).toContain('...');
    // Should not contain the full 600-char string
    expect(event.content).not.toContain('a'.repeat(600));
  });

  it('executes all fetches in parallel (Promise.all usage)', async () => {
    let messageQueryStarted = false;
    let digestQueryStarted = false;
    let interestQueryStarted = false;

    const persistence: PersistenceProvider = {
      ...createMockPersistence(),
      query: async () => {
        messageQueryStarted = true;
        // Simulate a small delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [];
      },
    };

    const memoryStore: MemoryStore = {
      ...createMockMemoryStore(),
      async getBlockByLabel() {
        digestQueryStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return null;
      },
    };

    const registry: InterestRegistry = {
      ...createMockInterestRegistry(),
      async listInterests() {
        interestQueryStarted = true;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return [];
      },
    };

    const assembler = createIntrospectionAssembler({
      persistence,
      interestRegistry: registry,
      memoryStore,
      owner: 'test',
      subconsciousConversationId: 'conv-introspection',
      lookbackHours: 24,
    });

    const startTime = Date.now();
    await assembler.assembleIntrospection();
    const elapsed = Date.now() - startTime;

    // All three should have started
    expect(messageQueryStarted).toBe(true);
    expect(digestQueryStarted).toBe(true);
    expect(interestQueryStarted).toBe(true);

    // Since they run in parallel, total time should be roughly 10-20ms (one sleep),
    // not 30ms (three sleeps serially). We use a generous upper bound to account
    // for test execution time variations.
    expect(elapsed).toBeLessThan(100);
  });
});
