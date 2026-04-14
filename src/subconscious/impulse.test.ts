import { describe, it, expect } from 'bun:test';
import { buildImpulseEvent } from './impulse';
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
