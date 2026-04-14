// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { InterestRegistry, Interest, CuriosityThread } from '../../subconscious/types.ts';
import { createSubconsciousTools } from './subconscious.ts';

function createMockInterestRegistry(): InterestRegistry & {
  calls: Array<{ method: string; args: Array<unknown> }>;
} {
  const calls: Array<{ method: string; args: Array<unknown> }> = [];

  return {
    calls,

    async createInterest(interest) {
      calls.push({ method: 'createInterest', args: [interest] });
      return {
        id: 'int-1',
        ...interest,
        createdAt: new Date(),
        lastEngagedAt: new Date(),
      };
    },

    async getInterest(id) {
      calls.push({ method: 'getInterest', args: [id] });
      return null;
    },

    async updateInterest(id, updates) {
      calls.push({ method: 'updateInterest', args: [id, updates] });
      return {
        id,
        owner: 'test',
        name: 'test interest',
        description: 'test',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
        ...updates,
      };
    },

    async listInterests(owner, filters) {
      calls.push({ method: 'listInterests', args: [owner, filters] });
      const interests: Array<Interest> = [
        {
          id: 'int-1',
          owner,
          name: 'test 1',
          description: 'desc 1',
          source: 'emergent',
          engagementScore: 2.0,
          status: 'active',
          lastEngagedAt: new Date(),
          createdAt: new Date(),
        },
        {
          id: 'int-2',
          owner,
          name: 'test 2',
          description: 'desc 2',
          source: 'seeded',
          engagementScore: 1.0,
          status: 'dormant',
          lastEngagedAt: new Date(),
          createdAt: new Date(),
        },
      ];

      // Apply filters
      let result = interests;
      if (filters?.status) {
        result = result.filter((i) => i.status === filters.status);
      }
      if (filters?.source) {
        result = result.filter((i) => i.source === filters.source);
      }
      if (filters?.minScore !== undefined) {
        result = result.filter((i) => i.engagementScore >= filters.minScore);
      }

      return result;
    },

    async createCuriosityThread(thread) {
      calls.push({ method: 'createCuriosityThread', args: [thread] });
      return {
        id: 'ct-1',
        ...thread,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    async getCuriosityThread(id) {
      calls.push({ method: 'getCuriosityThread', args: [id] });
      return {
        id,
        interestId: 'int-1',
        owner: 'test',
        question: 'test question',
        status: 'open',
        resolution: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    async updateCuriosityThread(id, updates) {
      calls.push({ method: 'updateCuriosityThread', args: [id, updates] });
      return {
        id,
        interestId: 'int-1',
        owner: 'test',
        question: 'test question',
        status: 'open',
        resolution: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...updates,
      };
    },

    async listCuriosityThreads(interestId, filters) {
      calls.push({ method: 'listCuriosityThreads', args: [interestId, filters] });
      const threads: Array<CuriosityThread> = [
        {
          id: 'ct-1',
          interestId,
          owner: 'test',
          question: 'question 1',
          status: 'open',
          resolution: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'ct-2',
          interestId,
          owner: 'test',
          question: 'question 2',
          status: 'exploring',
          resolution: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];

      if (filters?.status) {
        return threads.filter((t) => t.status === filters.status);
      }
      return threads;
    },

    async findDuplicateCuriosityThread(interestId, question) {
      calls.push({ method: 'findDuplicateCuriosityThread', args: [interestId, question] });
      return null;
    },

    async logExploration(entry) {
      calls.push({ method: 'logExploration', args: [entry] });
      return {
        id: 'log-1',
        ...entry,
        createdAt: new Date(),
      };
    },

    async listExplorationLog(owner, limit) {
      calls.push({ method: 'listExplorationLog', args: [owner, limit] });
      return [];
    },

    async applyEngagementDecay(owner, halfLifeDays) {
      calls.push({ method: 'applyEngagementDecay', args: [owner, halfLifeDays] });
      return 0;
    },

    async enforceActiveInterestCap(owner, maxActive) {
      calls.push({ method: 'enforceActiveInterestCap', args: [owner, maxActive] });
      return [];
    },

    async bumpEngagement(interestId, amount) {
      calls.push({ method: 'bumpEngagement', args: [interestId, amount] });
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

describe('subconscious.AC4.1: manage_interest tool', () => {
  it('creates an interest with name, description, and source', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_interest = tools.find((t) => t.definition.name === 'manage_interest');
    expect(manage_interest).toBeDefined();

    if (!manage_interest) return;

    const result = await manage_interest.handler({
      action: 'create',
      name: 'test',
      description: 'desc',
      source: 'emergent',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('createInterest');
    expect(result.output).toContain('int-1');
  });

  it('updates an interest name and description', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_interest = tools.find((t) => t.definition.name === 'manage_interest');
    expect(manage_interest).toBeDefined();

    if (!manage_interest) return;

    const result = await manage_interest.handler({
      action: 'update',
      id: 'int-1',
      name: 'new name',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('updateInterest');
    expect(result.output).toContain('int-1');
  });

  it('transitions an interest to dormant', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_interest = tools.find((t) => t.definition.name === 'manage_interest');
    expect(manage_interest).toBeDefined();

    if (!manage_interest) return;

    const result = await manage_interest.handler({
      action: 'transition',
      id: 'int-1',
      status: 'dormant',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('updateInterest');
    expect(result.output).toContain('dormant');
  });

  it('returns error for update without id', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_interest = tools.find((t) => t.definition.name === 'manage_interest');
    expect(manage_interest).toBeDefined();

    if (!manage_interest) return;

    const result = await manage_interest.handler({
      action: 'update',
      name: 'x',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('requires id');
  });

  it('returns error for unknown action', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_interest = tools.find((t) => t.definition.name === 'manage_interest');
    expect(manage_interest).toBeDefined();

    if (!manage_interest) return;

    const result = await manage_interest.handler({
      action: 'invalid',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('unknown action');
  });
});

describe('subconscious.AC4.3: list_interests tool', () => {
  it('lists all interests for owner', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_interests = tools.find((t) => t.definition.name === 'list_interests');
    expect(list_interests).toBeDefined();

    if (!list_interests) return;

    const result = await list_interests.handler({});

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('listInterests');
    expect(result.output).toContain('count');
    expect(result.output).toContain('2');
  });

  it('filters by status', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_interests = tools.find((t) => t.definition.name === 'list_interests');
    expect(list_interests).toBeDefined();

    if (!list_interests) return;

    const result = await list_interests.handler({ status: 'active' });

    expect(result.success).toBe(true);
    const callArgs = registry.calls[0]?.args as Array<unknown>;
    expect(callArgs[1]).toEqual({ status: 'active', source: undefined, minScore: undefined });
  });

  it('filters by source', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_interests = tools.find((t) => t.definition.name === 'list_interests');
    expect(list_interests).toBeDefined();

    if (!list_interests) return;

    const result = await list_interests.handler({ source: 'seeded' });

    expect(result.success).toBe(true);
    const callArgs = registry.calls[0]?.args as Array<unknown>;
    expect(callArgs[1]).toEqual({ status: undefined, source: 'seeded', minScore: undefined });
  });

  it('filters by minimum score', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_interests = tools.find((t) => t.definition.name === 'list_interests');
    expect(list_interests).toBeDefined();

    if (!list_interests) return;

    const result = await list_interests.handler({ min_score: 2.0 });

    expect(result.success).toBe(true);
    const callArgs = registry.calls[0]?.args as Array<unknown>;
    expect(callArgs[1]).toEqual({ status: undefined, source: undefined, minScore: 2.0 });
  });
});

describe('subconscious.AC4.2: manage_curiosity tool', () => {
  it('creates a new curiosity thread', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'create',
      interest_id: 'int-1',
      question: 'Why?',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('findDuplicateCuriosityThread');
    expect(registry.calls[1]?.method).toBe('createCuriosityThread');
    expect(registry.calls[2]?.method).toBe('bumpEngagement');
  });

  it('resumes existing duplicate thread instead of creating new', async () => {
    const mockRegistry = createMockInterestRegistry();
    const existingThread: CuriosityThread = {
      id: 'ct-existing',
      interestId: 'int-1',
      owner: 'test',
      question: 'Why?',
      status: 'open',
      resolution: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockRegistry.findDuplicateCuriosityThread = async () => existingThread;

    const tools = createSubconsciousTools({ registry: mockRegistry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'create',
      interest_id: 'int-1',
      question: 'Why?',
    });

    expect(result.success).toBe(true);
    expect(result.output).toContain('resumed');
    expect(result.output).toContain('ct-existing');
    // Should NOT have called createCuriosityThread
    const createCalls = mockRegistry.calls.filter((c) => c.method === 'createCuriosityThread');
    expect(createCalls.length).toBe(0);
  });

  it('transitions thread to exploring', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'explore',
      id: 'ct-1',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('getCuriosityThread');
    expect(registry.calls[1]?.method).toBe('updateCuriosityThread');
    expect(registry.calls[2]?.method).toBe('bumpEngagement');
    expect(result.output).toContain('exploring');
  });

  it('resolves thread with resolution text', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'resolve',
      id: 'ct-1',
      resolution: 'Found the answer',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[1]?.method).toBe('updateCuriosityThread');
    const updateCall = registry.calls[1];
    expect(updateCall?.args[1]).toEqual({ status: 'resolved', resolution: 'Found the answer' });
    expect(registry.calls[2]?.method).toBe('bumpEngagement');
  });

  it('parks thread', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'park',
      id: 'ct-1',
    });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('updateCuriosityThread');
    expect(result.output).toContain('parked');
  });

  it('returns error for create without interest_id', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'create',
      question: 'Why?',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('interest_id');
  });

  it('returns error for create without question', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const manage_curiosity = tools.find((t) => t.definition.name === 'manage_curiosity');
    expect(manage_curiosity).toBeDefined();

    if (!manage_curiosity) return;

    const result = await manage_curiosity.handler({
      action: 'create',
      interest_id: 'int-1',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('question');
  });
});

describe('subconscious.AC4.4: list_curiosities tool', () => {
  it('lists all curiosity threads for an interest', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_curiosities = tools.find((t) => t.definition.name === 'list_curiosities');
    expect(list_curiosities).toBeDefined();

    if (!list_curiosities) return;

    const result = await list_curiosities.handler({ interest_id: 'int-1' });

    expect(result.success).toBe(true);
    expect(registry.calls[0]?.method).toBe('listCuriosityThreads');
    expect(result.output).toContain('count');
    expect(result.output).toContain('2');
  });

  it('filters by status', async () => {
    const registry = createMockInterestRegistry();
    const tools = createSubconsciousTools({ registry, owner: 'test' });
    const list_curiosities = tools.find((t) => t.definition.name === 'list_curiosities');
    expect(list_curiosities).toBeDefined();

    if (!list_curiosities) return;

    const result = await list_curiosities.handler({ interest_id: 'int-1', status: 'open' });

    expect(result.success).toBe(true);
    const callArgs = registry.calls[0]?.args as Array<unknown>;
    expect(callArgs[1]).toEqual({ status: 'open' });
  });
});
