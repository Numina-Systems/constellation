// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { InterestRegistry, Interest, ExplorationLogEntry } from './types.ts';
import { createSubconsciousContextProvider } from './context.ts';

function createMockInterestRegistry(
  activeInterests: ReadonlyArray<Interest> = [],
  explorationLog: ReadonlyArray<ExplorationLogEntry> = [],
  dormantInterests: ReadonlyArray<Interest> = [],
): InterestRegistry & {
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
        name: 'test',
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
      if (filters?.status === 'active') {
        return activeInterests;
      }
      if (filters?.status === 'dormant') {
        return dormantInterests;
      }
      return [];
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
        question: 'test',
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
        question: 'test',
        status: 'open',
        resolution: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...updates,
      };
    },

    async listCuriosityThreads() {
      calls.push({ method: 'listCuriosityThreads', args: [] });
      return [];
    },

    async findDuplicateCuriosityThread() {
      calls.push({ method: 'findDuplicateCuriosityThread', args: [] });
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
      return explorationLog;
    },

    async applyEngagementDecay() {
      calls.push({ method: 'applyEngagementDecay', args: [] });
      return 0;
    },

    async enforceActiveInterestCap() {
      calls.push({ method: 'enforceActiveInterestCap', args: [] });
      return [];
    },

    async bumpEngagement() {
      calls.push({ method: 'bumpEngagement', args: [] });
      return {
        id: 'int-1',
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

describe('subconscious.AC4.5: Inner Life context injection', () => {
  it('formats active interests with engagement scores', async () => {
    const activeInterests: Array<Interest> = [
      {
        id: 'int-1',
        owner: 'test',
        name: 'Cryptography',
        description: 'Understanding modern encryption techniques',
        source: 'emergent',
        engagementScore: 8.5,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      },
      {
        id: 'int-2',
        owner: 'test',
        name: 'Neural Networks',
        description: 'Deep learning architectures',
        source: 'seeded',
        engagementScore: 7.2,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const registry = createMockInterestRegistry(activeInterests, [], []);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // Trigger refresh
    provider();
    // Wait for async refresh to complete
    await Bun.sleep(20);
    const result = provider();

    expect(result).toBeDefined();
    expect(result).toContain('[Inner Life]');
    expect(result).toContain('Active interests:');
    expect(result).toContain('Cryptography');
    expect(result).toContain('8.5');
    expect(result).toContain('Neural Networks');
    expect(result).toContain('7.2');
  });

  it('includes recent explorations', async () => {
    const explorationLog: Array<ExplorationLogEntry> = [
      {
        id: 'log-1',
        owner: 'test',
        interestId: 'int-1',
        curiosityThreadId: null,
        action: 'searched for',
        toolsUsed: ['web_search'],
        outcome: 'Found 3 papers on lattice-based cryptography',
        createdAt: new Date('2026-04-14T10:00:00Z'),
      },
      {
        id: 'log-2',
        owner: 'test',
        interestId: 'int-2',
        curiosityThreadId: null,
        action: 'experimented with',
        toolsUsed: ['execute_code'],
        outcome: 'Built a simple transformer implementation with attention mechanisms',
        createdAt: new Date('2026-04-14T09:00:00Z'),
      },
    ];

    const registry = createMockInterestRegistry([], explorationLog, []);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // Trigger refresh
    provider();
    await Bun.sleep(20);
    const result = provider();

    expect(result).toBeDefined();
    expect(result).toContain('[Inner Life]');
    expect(result).toContain('Recent explorations:');
    expect(result).toContain('searched for');
    expect(result).toContain('Found 3 papers on lattice-based cryptography');
    expect(result).toContain('experimented with');
    expect(result).toContain('transformer implementation');
  });

  it('shows dormant interest count', async () => {
    const activeInterests: Array<Interest> = [
      {
        id: 'int-1',
        owner: 'test',
        name: 'Active Interest',
        description: 'Currently active',
        source: 'emergent',
        engagementScore: 5.0,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const dormantInterests: Array<Interest> = [
      {
        id: 'dorm-1',
        owner: 'test',
        name: 'Philosophy',
        description: 'Epistemology and metaphysics',
        source: 'seeded',
        engagementScore: 2.1,
        status: 'dormant',
        lastEngagedAt: new Date('2026-02-01'),
        createdAt: new Date(),
      },
      {
        id: 'dorm-2',
        owner: 'test',
        name: 'Linguistics',
        description: 'Natural language processing',
        source: 'emergent',
        engagementScore: 1.8,
        status: 'dormant',
        lastEngagedAt: new Date('2026-01-15'),
        createdAt: new Date(),
      },
      {
        id: 'dorm-3',
        owner: 'test',
        name: 'Topology',
        description: 'Abstract mathematics',
        source: 'seeded',
        engagementScore: 1.5,
        status: 'dormant',
        lastEngagedAt: new Date('2026-01-10'),
        createdAt: new Date(),
      },
      {
        id: 'dorm-4',
        owner: 'test',
        name: 'Music Theory',
        description: 'Harmony and composition',
        source: 'emergent',
        engagementScore: 1.2,
        status: 'dormant',
        lastEngagedAt: new Date('2026-01-05'),
        createdAt: new Date(),
      },
    ];

    const registry = createMockInterestRegistry(activeInterests, [], dormantInterests);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // Trigger refresh
    provider();
    await Bun.sleep(20);
    const result = provider();

    expect(result).toBeDefined();
    expect(result).toContain('Dormant interests:');
    expect(result).toContain('4');
    expect(result).toContain('Philosophy');
    expect(result).toContain('Linguistics');
    expect(result).toContain('Topology');
    // Should not show Music Theory (only first 3)
    expect(result).not.toContain('Music Theory');
  });

  it('caches result within TTL', async () => {
    const activeInterests: Array<Interest> = [
      {
        id: 'int-1',
        owner: 'test',
        name: 'Test Interest',
        description: 'Test',
        source: 'emergent',
        engagementScore: 5.0,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const registry = createMockInterestRegistry(activeInterests, [], []);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // First call triggers refresh
    provider();
    await Bun.sleep(20);
    const result1 = provider();

    // Record initial call count
    const initialCalls = registry.calls.length;

    // Second call immediately after should use cache
    const result2 = provider();

    // Both results should be the same (same object reference or equal content)
    expect(result1).toEqual(result2);

    // Verify registry wasn't called again (cache hit)
    expect(registry.calls.length).toBe(initialCalls);
  });
});

describe('subconscious.AC4.6: Empty state handling', () => {
  it('returns undefined when no interests or explorations exist', async () => {
    const registry = createMockInterestRegistry([], [], []);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // Trigger refresh
    provider();
    await Bun.sleep(20);
    const result = provider();

    expect(result).toBeUndefined();
  });

  it('returns undefined on first call before refresh completes', async () => {
    const activeInterests: Array<Interest> = [
      {
        id: 'int-1',
        owner: 'test',
        name: 'Test',
        description: 'Test',
        source: 'emergent',
        engagementScore: 5.0,
        status: 'active',
        lastEngagedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const registry = createMockInterestRegistry(activeInterests, [], []);
    const provider = createSubconsciousContextProvider(registry, 'test');

    // Call immediately without waiting for refresh
    const result = provider();

    // Should be undefined because no data cached yet
    expect(result).toBeUndefined();
  });
});
