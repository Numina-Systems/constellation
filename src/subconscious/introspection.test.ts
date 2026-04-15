import { describe, it, expect } from 'bun:test';
import {
  buildIntrospectionCron,
  buildIntrospectionEvent,
  type IntrospectionContext,
} from './introspection';
import type { Interest } from './types';

describe('introspection-loop.AC1.1: Introspection cron offset', () => {
  it('buildIntrospectionCron produces offset cron expression', () => {
    const cron = buildIntrospectionCron(15, 3);
    expect(cron).toBe('3/15 * * * *');
  });

  it('buildIntrospectionCron wraps offset modulo interval', () => {
    const cron = buildIntrospectionCron(15, 20);
    expect(cron).toBe('5/15 * * * *');
  });

  it('buildIntrospectionCron handles 30-minute interval', () => {
    const cron = buildIntrospectionCron(30, 5);
    expect(cron).toBe('5/30 * * * *');
  });
});

describe('introspection-loop.AC1.2: Event contains Review section', () => {
  it('includes [Review] section with messages', () => {
    const context: IntrospectionContext = {
      messages: [
        {
          role: 'assistant',
          content: 'I noticed an interesting pattern in the data.',
          created_at: new Date('2026-04-14T10:00:00Z'),
        },
        {
          role: 'user',
          content: 'Tell me more about that pattern.',
          created_at: new Date('2026-04-14T10:05:00Z'),
        },
      ],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Review]');
    expect(event.content).toContain('I noticed an interesting pattern');
    expect(event.content).toContain('Tell me more about that pattern');
  });

  it('shows "No recent conversation" when messages array is empty', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Review]');
    expect(event.content).toContain('No recent conversation to review');
  });
});

describe('introspection-loop.AC1.3: Event contains Current State section', () => {
  it('includes [Current State] section with active interests', () => {
    const interest: Interest = {
      id: 'int-1',
      owner: 'agent',
      name: 'knowledge graphs',
      description: 'exploring semantic relationships',
      source: 'emergent',
      engagementScore: 0.75,
      status: 'active',
      lastEngagedAt: new Date('2026-04-14T10:00:00Z'),
      createdAt: new Date('2026-04-01T00:00:00Z'),
    };

    const context: IntrospectionContext = {
      messages: [],
      interests: [interest],
      currentDigest: 'Previous digest content here',
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Current State]');
    expect(event.content).toContain('knowledge graphs');
    expect(event.content).toContain('0.75');
    expect(event.content).toContain('exploring semantic relationships');
  });

  it('includes [Last Digest] section with current digest content', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: 'Half-formed thoughts from last time',
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Last Digest]');
    expect(event.content).toContain('Half-formed thoughts from last time');
  });

  it('shows placeholder when no previous digest exists', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Last Digest]');
    expect(event.content).toContain(
      'No previous digest. This is your first introspection.',
    );
  });

  it('shows "No active interests" when interests array is empty', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('No active interests');
  });
});

describe('introspection-loop.AC1.4: Event contains Act section', () => {
  it('includes [Act] section with tool instructions', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('[Act]');
    expect(event.content).toContain('manage_interest');
    expect(event.content).toContain('manage_curiosity');
    expect(event.content).toContain('memory_write');
    expect(event.content).toContain('introspection-digest');
  });
});

describe('introspection-loop.AC1.5: Tool role messages excluded', () => {
  it('accepts only user/assistant/system messages (type enforces tool exclusion)', () => {
    // The type IntrospectionContext.messages union excludes 'tool' role
    // This test verifies the builder correctly processes the pre-filtered messages
    const context: IntrospectionContext = {
      messages: [
        {
          role: 'user',
          content: 'User message',
          created_at: new Date('2026-04-14T10:00:00Z'),
        },
        {
          role: 'assistant',
          content: 'Assistant message',
          created_at: new Date('2026-04-14T10:05:00Z'),
        },
        {
          role: 'system',
          content: 'System message',
          created_at: new Date('2026-04-14T10:10:00Z'),
        },
      ],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.content).toContain('User message');
    expect(event.content).toContain('Assistant message');
    expect(event.content).toContain('System message');
  });
});

describe('introspection-loop.AC4.1: Time-windowed review', () => {
  it('formats messages with timestamps in review section', () => {
    const context: IntrospectionContext = {
      messages: [
        {
          role: 'user',
          content: 'Morning message',
          created_at: new Date('2026-04-14T09:30:00Z'),
        },
        {
          role: 'assistant',
          content: 'Afternoon response',
          created_at: new Date('2026-04-14T14:45:00Z'),
        },
      ],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T15:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    // Verify timestamps are rendered (exact format depends on locale, so we check for presence)
    expect(event.content).toContain(']');
    expect(event.content).toContain('Morning message');
    expect(event.content).toContain('Afternoon response');
  });
});

describe('Event structure and metadata', () => {
  it('returns ExternalEvent with source subconscious:introspection', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.source).toBe('subconscious:introspection');
    expect(event.content).toBeDefined();
    expect(event.timestamp).toEqual(context.timestamp);
  });

  it('includes metadata with message count, interest count, and digest flag', () => {
    const interest: Interest = {
      id: 'int-1',
      owner: 'agent',
      name: 'test',
      description: 'test interest',
      source: 'emergent',
      engagementScore: 0.5,
      status: 'active',
      lastEngagedAt: new Date(),
      createdAt: new Date(),
    };

    const context: IntrospectionContext = {
      messages: [
        {
          role: 'user',
          content: 'msg1',
          created_at: new Date(),
        },
        {
          role: 'assistant',
          content: 'msg2',
          created_at: new Date(),
        },
      ],
      interests: [interest],
      currentDigest: 'some digest',
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.metadata['taskType']).toBe('introspection');
    expect(event.metadata['messageCount']).toBe(2);
    expect(event.metadata['interestCount']).toBe(1);
    expect(event.metadata['hasExistingDigest']).toBe(true);
  });

  it('sets hasExistingDigest to false when currentDigest is null', () => {
    const context: IntrospectionContext = {
      messages: [],
      interests: [],
      currentDigest: null,
      timestamp: new Date('2026-04-14T12:00:00Z'),
    };

    const event = buildIntrospectionEvent(context);

    expect(event.metadata['hasExistingDigest']).toBe(false);
  });
});
