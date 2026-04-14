import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { buildImpulseEvent, buildMorningAgendaEvent, buildWrapUpEvent } from './impulse';
import { createPostgresProvider } from '@/persistence/postgres';
import { createInterestRegistry } from './persistence';
import type { Interest, ExplorationLogEntry } from './types';
import type { OperationTrace } from '../reflexion/types';

describe('subconscious.AC1.2: Impulse prompt structure', () => {
  it('builds a prompt with Reflect, Generate, and Act sections', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Reflect]');
    expect(event.content).toContain('[Generate]');
    expect(event.content).toContain('[Act]');
  });

  it('returns ExternalEvent with source subconscious:impulse', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.source).toBe('subconscious:impulse');
    expect(event.metadata['taskType']).toBe('impulse');
    expect(event.metadata['interestCount']).toBe(0);
    expect(event.metadata['traceCount']).toBe(0);
    expect(event.timestamp).toEqual(context.timestamp);
  });
});

describe('subconscious.AC1.3: Impulse prompt content', () => {
  it('includes active interests with scores', () => {
    const interest: Interest = {
      id: 'int-1',
      owner: 'agent',
      name: 'machine learning',
      description: 'neural networks and transformers',
      source: 'emergent',
      engagementScore: 0.85,
      status: 'active',
      lastEngagedAt: new Date('2026-04-14T10:00:00Z'),
      createdAt: new Date('2026-04-01T00:00:00Z'),
    };

    const context = {
      interests: [interest],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('machine learning');
    expect(event.content).toContain('0.85');
    expect(event.content).toContain('emergent');
    expect(event.content).toContain('neural networks and transformers');
  });

  it('includes recent traces via formatTraceSummary', () => {
    const trace: OperationTrace = {
      id: 'trace-1',
      owner: 'agent',
      conversationId: 'conv-1',
      toolName: 'web_search',
      input: { query: 'test' },
      outputSummary: 'Found 5 results about neural networks',
      durationMs: 1500,
      success: true,
      error: null,
      createdAt: new Date('2026-04-14T11:30:00Z'),
    };

    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [trace],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Recent Activity]');
    expect(event.content).toContain('web_search');
    expect(event.content).toContain('Found 5 results');
  });

  it('includes recent memories', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: ['Interested in deep learning since last week', 'Built a transformer model yesterday'],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Recent Memories]');
    expect(event.content).toContain('Interested in deep learning since last week');
    expect(event.content).toContain('Built a transformer model yesterday');
  });

  it('includes recent explorations', () => {
    const exploration: ExplorationLogEntry = {
      id: 'exp-1',
      owner: 'agent',
      interestId: 'int-1',
      curiosityThreadId: null,
      action: 'searched for transformer architectures',
      toolsUsed: ['web_search', 'code_execution'],
      outcome: 'found three promising papers and wrote a summary',
      createdAt: new Date('2026-04-14T11:00:00Z'),
    };

    const context = {
      interests: [],
      recentExplorations: [exploration],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Recent Explorations]');
    expect(event.content).toContain('searched for transformer architectures');
    expect(event.content).toContain('found three promising papers');
  });

  it('shows cold-start prompt when no interests exist', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('You have no interests yet. What are you curious about?');
  });

  it('handles all-empty context gracefully', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.source).toBe('subconscious:impulse');
    expect(event.content).toContain('[Reflect]');
    expect(event.content).toContain('[Generate]');
    expect(event.content).toContain('[Act]');
    expect(event.content).toContain('No recent activity');
    expect(event.content).toContain('No recent memories');
    expect(event.content).toContain('No recent explorations');
  });
});

describe('subconscious.AC5.1: Morning agenda impulse', () => {
  it('buildMorningAgendaEvent produces event with morning-agenda source', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T08:00:00Z'),
    };

    const event = buildMorningAgendaEvent(context);

    expect(event.source).toBe('subconscious:morning-agenda');
    expect(event.metadata['taskType']).toBe('morning-agenda');
    expect(event.metadata['impulseType']).toBe('transition');
    expect(event.timestamp).toEqual(context.timestamp);
  });

  it('morning agenda prompt includes interest review instructions', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T08:00:00Z'),
    };

    const event = buildMorningAgendaEvent(context);

    expect(event.content).toContain('[Morning Agenda]');
    expect(event.content).toContain('Good morning');
    expect(event.content).toContain('Review your interests');
    expect(event.content).toContain('plan your day');
  });

  it('morning agenda includes active interests', () => {
    const interest: Interest = {
      id: 'int-1',
      owner: 'agent',
      name: 'deep reinforcement learning',
      description: 'exploring policy gradient methods',
      source: 'emergent',
      engagementScore: 0.75,
      status: 'active',
      lastEngagedAt: new Date('2026-04-14T06:00:00Z'),
      createdAt: new Date('2026-04-01T00:00:00Z'),
    };

    const context = {
      interests: [interest],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T08:00:00Z'),
    };

    const event = buildMorningAgendaEvent(context);

    expect(event.content).toContain('[Active Interests]');
    expect(event.content).toContain('deep reinforcement learning');
    expect(event.content).toContain('0.75');
  });
});

describe('subconscious.AC5.2: Wrap-up reflection impulse', () => {
  it('buildWrapUpEvent produces event with wrap-up source', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T20:00:00Z'),
    };

    const event = buildWrapUpEvent(context);

    expect(event.source).toBe('subconscious:wrap-up');
    expect(event.metadata['taskType']).toBe('wrap-up');
    expect(event.metadata['impulseType']).toBe('transition');
    expect(event.timestamp).toEqual(context.timestamp);
  });

  it('wrap-up prompt includes reflection questions', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T20:00:00Z'),
    };

    const event = buildWrapUpEvent(context);

    expect(event.content).toContain('[Wrap Up]');
    expect(event.content).toContain('End of day');
    expect(event.content).toContain('What did you learn?');
    expect(event.content).toContain('curiosity threads');
  });
});

describe('subconscious.AC5.3: Exploration log in impulse context', () => {
  it('impulse prompt includes exploration log entries when present', () => {
    const exploration: ExplorationLogEntry = {
      id: 'exp-1',
      owner: 'agent',
      interestId: 'int-1',
      curiosityThreadId: null,
      action: 'researched policy gradient methods',
      toolsUsed: ['web_search', 'memory_write'],
      outcome: 'found 3 papers and saved notes',
      createdAt: new Date('2026-04-14T11:00:00Z'),
    };

    const context = {
      interests: [],
      recentExplorations: [exploration],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Recent Explorations]');
    expect(event.content).toContain('researched policy gradient methods');
    expect(event.content).toContain('found 3 papers and saved notes');
  });

  it('impulse prompt handles empty exploration log gracefully', () => {
    const context = {
      interests: [],
      recentExplorations: [],
      recentTraces: [],
      recentMemories: [],
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildImpulseEvent(context);

    expect(event.content).toContain('[Recent Explorations]');
    expect(event.content).toContain('No recent explorations.');
  });

  // DB-backed test for JSONB array serialization
  describe('JSONB array serialization', () => {
    const TEST_OWNER = 'impulse-test-' + Math.random().toString(36).substring(7);
    const DB_CONNECTION_STRING = 'postgresql://constellation:constellation@localhost:5432/constellation';

    let persistence: ReturnType<typeof createPostgresProvider>;
    let registry: ReturnType<typeof createInterestRegistry>;

    beforeAll(async () => {
      persistence = createPostgresProvider({ url: DB_CONNECTION_STRING });
      await persistence.connect();
      await persistence.runMigrations();
      registry = createInterestRegistry(persistence);
    });

    afterEach(async () => {
      await persistence.query('TRUNCATE TABLE exploration_log CASCADE');
      await persistence.query('TRUNCATE TABLE interests CASCADE');
    });

    afterAll(async () => {
      await persistence.disconnect();
    });

    it('exploration log entries preserve tools_used as JSONB array', async () => {
      const interest = await registry.createInterest({
        owner: TEST_OWNER,
        name: 'Test Interest',
        description: 'Testing JSONB serialization',
        source: 'emergent',
        engagementScore: 1.0,
        status: 'active',
      });

      await registry.logExploration({
        owner: TEST_OWNER,
        interestId: interest.id,
        curiosityThreadId: null,
        action: 'tested web search and code execution',
        toolsUsed: ['web_search', 'code_execution', 'memory_write'],
        outcome: 'verified all tools work correctly',
      });

      const retrieved = await registry.listExplorationLog(TEST_OWNER, 1);

      expect(retrieved).toHaveLength(1);
      expect(retrieved[0]!.toolsUsed).toEqual(['web_search', 'code_execution', 'memory_write']);
      expect(Array.isArray(retrieved[0]!.toolsUsed)).toBe(true);
    });
  });
});
