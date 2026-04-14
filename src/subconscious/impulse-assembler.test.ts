// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { createImpulseAssembler } from './impulse-assembler';
import type { InterestRegistry, Interest } from './types';
import type { TraceStore } from '@/reflexion';
import type { MemoryManager } from '@/memory';
import type { MemorySearchResult } from '@/memory/types';
import type { OperationTrace } from '@/reflexion/types';

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

function createMockTraceStore(): TraceStore {
  return {
    async record() {
      // no-op
    },

    async queryTraces() {
      const trace: OperationTrace = {
        id: 'trace-1',
        owner: 'test',
        conversationId: 'conv-1',
        toolName: 'web_search',
        input: { query: 'machine learning' },
        outputSummary: 'Found 10 results about transformers',
        durationMs: 1200,
        success: true,
        error: null,
        createdAt: new Date(),
      };
      return [trace];
    },
  };
}

function createMockMemoryManager(): MemoryManager {
  const mockBlock = {
    id: 'block-1',
    owner: 'test',
    tier: 'working' as const,
    label: 'recent thoughts',
    content: 'Exploring transformer architectures',
    embedding: null,
    permission: 'append' as const,
    pinned: false,
    created_at: new Date(),
    updated_at: new Date(),
  };

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
      const result: MemorySearchResult = {
        block: mockBlock,
        similarity: 0.95,
      };
      return [result];
    },

    async write() {
      return {
        applied: true,
        block: mockBlock,
      };
    },

    async list() {
      return [];
    },

    async deleteBlock() {
      return undefined;
    },

    async getPendingMutations() {
      return [];
    },

    async approveMutation() {
      return mockBlock;
    },

    async rejectMutation() {
      return {
        id: 'mutation-1',
        block_id: 'block-1',
        proposed_content: 'test',
        reason: null,
        status: 'rejected' as const,
        feedback: null,
        created_at: new Date(),
        resolved_at: new Date(),
      };
    },
  };
}

describe('subconscious.AC1.1: createImpulseAssembler gathers context', () => {
  it('creates assembler with mocked dependencies', () => {
    const interestRegistry = createMockInterestRegistry();
    const traceStore = createMockTraceStore();
    const memory = createMockMemoryManager();

    const assembler = createImpulseAssembler({
      interestRegistry,
      traceStore,
      memory,
      owner: 'test',
    });

    expect(assembler).toBeDefined();
    expect(typeof assembler.assembleImpulse).toBe('function');
    expect(typeof assembler.assembleMorningAgenda).toBe('function');
    expect(typeof assembler.assembleWrapUp).toBe('function');
  });

  it('assembleImpulse() queries InterestRegistry, TraceStore, and MemoryManager', async () => {
    let interestRegistryQueried = false;
    let traceStoreQueried = false;
    let memoryQueried = false;

    const mockRegistry = {
      ...createMockInterestRegistry(),
      listInterests: async (owner: string, filters?: any) => {
        interestRegistryQueried = true;
        return (await createMockInterestRegistry().listInterests(owner, filters)) as any;
      },
    };

    const mockTraceStore = {
      ...createMockTraceStore(),
      queryTraces: async (query: any) => {
        traceStoreQueried = true;
        return (await createMockTraceStore().queryTraces(query)) as any;
      },
    };

    const mockMemory = {
      ...createMockMemoryManager(),
      read: async (query: string, limit?: number, tier?: any) => {
        memoryQueried = true;
        return (await createMockMemoryManager().read(query, limit, tier)) as any;
      },
    };

    const assembler = createImpulseAssembler({
      interestRegistry: mockRegistry,
      traceStore: mockTraceStore,
      memory: mockMemory,
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    expect(interestRegistryQueried).toBe(true);
    expect(traceStoreQueried).toBe(true);
    expect(memoryQueried).toBe(true);
    expect(event).toBeDefined();
  });

  it('assembleImpulse() returns ExternalEvent with source subconscious:impulse', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    expect(event.source).toBe('subconscious:impulse');
  });

  it('assembleImpulse() returns ExternalEvent with correct metadata', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    expect(event.metadata).toBeDefined();
    expect(event.metadata['taskType']).toBe('impulse');
    expect(typeof event.metadata['interestCount']).toBe('number');
    expect(typeof event.metadata['traceCount']).toBe('number');
  });

  it('assembleImpulse() includes interests from registry', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    // The mock registry returns one interest with name 'machine learning'
    expect(event.metadata['interestCount']).toBe(1);
    expect(event.content).toContain('machine learning');
  });

  it('assembleImpulse() includes recent traces from trace store', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    // The mock trace store returns one trace with toolName 'web_search'
    expect(event.metadata['traceCount']).toBe(1);
    expect(event.content).toContain('web_search');
  });

  it('assembleImpulse() includes recent memories from memory manager', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleImpulse();

    // The mock memory manager returns memory with content 'Exploring transformer architectures'
    expect(event.content).toContain('Exploring transformer architectures');
  });

  it('assembleImpulse() queries traces with correct lookback window', async () => {
    let capturedQuery: Parameters<TraceStore['queryTraces']>[0] | undefined;

    const mockTraceStore: TraceStore = {
      async record(_trace) {
        // no-op
      },
      async queryTraces(query) {
        capturedQuery = query;
        return [];
      },
    };

    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: mockTraceStore,
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    await assembler.assembleImpulse();

    expect(capturedQuery).toBeDefined();
    expect(capturedQuery?.owner).toBe('test');
    expect(capturedQuery?.lookbackSince).toBeDefined();
    // Verify lookback is roughly 2 hours (120 minutes)
    const now = Date.now();
    const lookbackMs = now - capturedQuery!.lookbackSince!.getTime();
    const lookbackMinutes = lookbackMs / (60 * 1000);
    expect(lookbackMinutes).toBeCloseTo(120, 1);
    expect(capturedQuery?.limit).toBe(20);
  });

  it('assembleImpulse() queries interests with active status filter', async () => {
    let capturedFilters: Parameters<InterestRegistry['listInterests']>[1] | undefined;

    const mockRegistry: InterestRegistry = {
      ...createMockInterestRegistry(),
      async listInterests(_owner, filters) {
        capturedFilters = filters;
        return [];
      },
    };

    const assembler = createImpulseAssembler({
      interestRegistry: mockRegistry,
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    await assembler.assembleImpulse();

    expect(capturedFilters).toBeDefined();
    expect(capturedFilters?.status).toBe('active');
  });

  it('assembleImpulse() queries memory with correct parameters', async () => {
    let capturedQuery: [string, number | undefined, string | undefined] | undefined;

    const mockMemory: MemoryManager = {
      ...createMockMemoryManager(),
      async read(query, limit, tier) {
        capturedQuery = [query, limit, tier];
        return [];
      },
    };

    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: mockMemory,
      owner: 'test',
    });

    await assembler.assembleImpulse();

    expect(capturedQuery).toBeDefined();
    expect(capturedQuery?.[0]).toContain('recent thoughts');
    expect(capturedQuery?.[1]).toBe(5);
    expect(capturedQuery?.[2]).toBe('working');
  });

  it('assembleMorningAgenda() returns event with correct source', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleMorningAgenda();

    expect(event.source).toBe('subconscious:morning-agenda');
    expect(event.metadata['taskType']).toBe('morning-agenda');
  });

  it('assembleWrapUp() returns event with correct source', async () => {
    const assembler = createImpulseAssembler({
      interestRegistry: createMockInterestRegistry(),
      traceStore: createMockTraceStore(),
      memory: createMockMemoryManager(),
      owner: 'test',
    });

    const event = await assembler.assembleWrapUp();

    expect(event.source).toBe('subconscious:wrap-up');
    expect(event.metadata['taskType']).toBe('wrap-up');
  });
});
