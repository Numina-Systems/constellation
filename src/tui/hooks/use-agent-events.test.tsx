// pattern: Imperative Shell

import { describe, it, expect, beforeEach } from 'bun:test';
import React from 'react';
import { Text } from 'ink';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents, useLatestAgentEvent } from './use-agent-events.ts';

describe('useAgentEvents hook', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = createAgentEventBus();
  });

  it('subscribes on mount and receives matching events', async () => {
    const eventTracker: Array<AgentEvent> = [];

    function TestComponent() {
      const events = useAgentEvents(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );
      // Update tracker with current events each render
      if (events.length > 0) {
        eventTracker.length = 0;
        eventTracker.push(...events);
      }
      return React.createElement(Text, null, `Events: ${events.length}`);
    }

    const { lastFrame } = render(React.createElement(TestComponent));

    // Initially no events - check that render() succeeded
    let output = lastFrame();
    expect(output).toContain('Events: 0');

    // Publish a matching event
    bus.publish({ type: 'stream:chunk', text: 'hello', turnIndex: 0 });

    // Give React time to process the state update
    await new Promise((resolve) => setTimeout(resolve, 50));

    output = lastFrame();
    expect(output).toContain('Events: 1');
    expect(eventTracker).toHaveLength(1);
    expect(eventTracker[0]).toEqual({
      type: 'stream:chunk',
      text: 'hello',
      turnIndex: 0,
    });
  });

  it('ignores events that do not match the filter', async () => {
    const eventTracker: Array<AgentEvent> = [];

    function TestComponent() {
      const events = useAgentEvents(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );
      if (events.length > 0) {
        eventTracker.length = 0;
        eventTracker.push(...events);
      }
      return React.createElement(Text, null, `Chunks: ${events.length}`);
    }

    const { lastFrame } = render(React.createElement(TestComponent));

    // Publish non-matching events
    bus.publish({ type: 'turn:start', source: 'user' });
    bus.publish({ type: 'activity:sleep' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Only stream:chunk events should be collected
    expect(eventTracker).toHaveLength(0);
    expect(lastFrame()).toContain('Chunks: 0');

    // Publish a matching event
    bus.publish({ type: 'stream:chunk', text: 'chunk', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('Chunks: 1');
    expect(eventTracker).toHaveLength(1);
  });

  it('unsubscribes on unmount and ignores events after unmount', async () => {
    const eventTracker: Array<AgentEvent> = [];

    function TestComponent() {
      const events = useAgentEvents(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );
      if (events.length > 0) {
        eventTracker.length = 0;
        eventTracker.push(...events);
      }
      return React.createElement(Text, null, `Events: ${events.length}`);
    }

    const { unmount } = render(React.createElement(TestComponent));

    // Publish before unmount
    bus.publish({ type: 'stream:chunk', text: 'before', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(eventTracker).toHaveLength(1);

    // Unmount the component
    unmount();

    // Clear tracker to verify no new events
    const countBeforeUnmount = eventTracker.length;

    // Publish after unmount
    bus.publish({ type: 'stream:chunk', text: 'after', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should still be 1, not 2
    expect(eventTracker).toHaveLength(countBeforeUnmount);
  });

  it('processes all rapid events', async () => {
    const eventTracker: Array<AgentEvent> = [];

    function TestComponent() {
      const events = useAgentEvents(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );

      // Record events each render
      if (events.length > 0) {
        eventTracker.length = 0;
        eventTracker.push(...events);
      }

      return React.createElement(Text, null, `Events: ${events.length}`);
    }

    const { lastFrame } = render(React.createElement(TestComponent));

    // Publish multiple events rapidly
    bus.publish({ type: 'stream:chunk', text: 'a', turnIndex: 0 });
    bus.publish({ type: 'stream:chunk', text: 'b', turnIndex: 0 });
    bus.publish({ type: 'stream:chunk', text: 'c', turnIndex: 0 });

    // Give React time to process updates
    await new Promise((resolve) => setTimeout(resolve, 50));

    // All events should be received
    expect(eventTracker).toHaveLength(3);
    expect(lastFrame()).toContain('Events: 3');
  });
});

describe('useLatestAgentEvent hook', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = createAgentEventBus();
  });

  it('returns only the most recent matching event', async () => {
    const tracker: { event: AgentEvent | null } = { event: null };

    function TestComponent() {
      const event = useLatestAgentEvent(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );
      tracker.event = event;
      const text =
        event && event.type === 'stream:chunk' ? `Latest: ${event.text}` : 'None';
      return React.createElement(Text, null, text);
    }

    const { lastFrame } = render(React.createElement(TestComponent));

    // Initially null - check frame
    expect(lastFrame()).toContain('None');
    expect(tracker.event).toBeNull();

    // Publish first event
    bus.publish({ type: 'stream:chunk', text: 'first', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('first');
    expect(tracker.event?.type).toBe('stream:chunk');
    if (tracker.event?.type === 'stream:chunk') {
      expect(tracker.event.text).toBe('first');
      expect(tracker.event.turnIndex).toBe(0);
    }

    // Publish second event
    bus.publish({ type: 'stream:chunk', text: 'second', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should only have the second (most recent)
    expect(lastFrame()).toContain('second');
    expect(tracker.event?.type).toBe('stream:chunk');
    if (tracker.event?.type === 'stream:chunk') {
      expect(tracker.event.text).toBe('second');
      expect(tracker.event.turnIndex).toBe(0);
    }
  });

  it('ignores non-matching events', async () => {
    const tracker: { event: AgentEvent | null } = { event: null };

    function TestComponent() {
      const event = useLatestAgentEvent(
        bus,
        (event): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
          event.type === 'stream:chunk'
      );
      tracker.event = event;
      const text =
        event && event.type === 'stream:chunk' ? `Latest: ${event.text}` : 'None';
      return React.createElement(Text, null, text);
    }

    const { lastFrame } = render(React.createElement(TestComponent));

    // Publish non-matching events
    bus.publish({ type: 'turn:start', source: 'user' });
    bus.publish({ type: 'activity:wake', reason: 'test' });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('None');
    expect(tracker.event).toBeNull();

    // Publish a matching event
    bus.publish({ type: 'stream:chunk', text: 'match', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('match');
    if (tracker.event?.type === 'stream:chunk') {
      expect(tracker.event.text).toBe('match');
    }
  });
});
