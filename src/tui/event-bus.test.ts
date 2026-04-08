// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { createAgentEventBus } from './event-bus.ts';
import type { AgentEvent } from './types.ts';

function createTestEvent(overrides?: Partial<AgentEvent>): AgentEvent {
  const base: AgentEvent = { type: 'stream:start', model: 'claude-3', turnIndex: 0 };
  return { ...base, ...overrides } as AgentEvent;
}

describe('createAgentEventBus', () => {
  describe('tui.AC1.1: Publish delivers to all subscribers', () => {
    it('delivers event to all subscribers', () => {
      const bus = createAgentEventBus();
      const received1: Array<AgentEvent> = [];
      const received2: Array<AgentEvent> = [];

      bus.subscribe(event => received1.push(event));
      bus.subscribe(event => received2.push(event));

      const event = createTestEvent();
      bus.publish(event);

      expect(received1).toEqual([event]);
      expect(received2).toEqual([event]);
    });
  });

  describe('tui.AC1.2: Subscribers only receive filtered events', () => {
    it('filters events by predicate', () => {
      const bus = createAgentEventBus();
      const received: Array<AgentEvent> = [];

      const filter = (event: AgentEvent) => event.type === 'stream:chunk';
      bus.subscribe(event => received.push(event), filter);

      const streamChunk = createTestEvent({ type: 'stream:chunk', text: 'hello' });
      const toolStart = createTestEvent({ type: 'tool:start', toolName: 'search', toolId: 'abc', input: {} });

      bus.publish(streamChunk);
      bus.publish(toolStart);

      expect(received).toEqual([streamChunk]);
    });
  });

  describe('tui.AC1.3: Unsubscribe stops delivery', () => {
    it('unsubscribed listener does not receive events', () => {
      const bus = createAgentEventBus();
      const received: Array<AgentEvent> = [];

      const unsubscribe = bus.subscribe(event => received.push(event));

      const event1 = createTestEvent({ turnIndex: 1 });
      bus.publish(event1);
      expect(received).toHaveLength(1);

      unsubscribe();

      const event2 = createTestEvent({ turnIndex: 2 });
      bus.publish(event2);
      expect(received).toHaveLength(1);
    });

    it('unsubscribe is idempotent', () => {
      const bus = createAgentEventBus();
      const unsubscribe = bus.subscribe(() => {});

      unsubscribe();
      unsubscribe();
      unsubscribe();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('tui.AC1.4: Publish with zero subscribers', () => {
    it('does not throw when publishing with no subscribers', () => {
      const bus = createAgentEventBus();
      const event = createTestEvent();

      expect(() => bus.publish(event)).not.toThrow();
    });
  });

  describe('edge cases', () => {
    it('failing listener does not prevent other listeners from receiving', () => {
      const bus = createAgentEventBus();
      const received1: Array<AgentEvent> = [];
      const received2: Array<AgentEvent> = [];

      bus.subscribe(() => {
        throw new Error('listener error');
      });
      bus.subscribe(event => received1.push(event));
      bus.subscribe(() => {
        throw new Error('another error');
      });
      bus.subscribe(event => received2.push(event));

      const event = createTestEvent();
      expect(() => bus.publish(event)).not.toThrow();

      expect(received1).toEqual([event]);
      expect(received2).toEqual([event]);
    });

    it('clear removes all listeners', () => {
      const bus = createAgentEventBus();
      const received: Array<AgentEvent> = [];

      bus.subscribe(event => received.push(event));
      bus.subscribe(() => {});
      bus.subscribe(() => {});

      const event1 = createTestEvent({ turnIndex: 1 });
      bus.publish(event1);
      expect(received).toHaveLength(1);

      bus.clear();

      const event2 = createTestEvent({ turnIndex: 2 });
      bus.publish(event2);
      expect(received).toHaveLength(1);
    });
  });
});
