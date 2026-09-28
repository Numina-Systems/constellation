/**
 * Tests for the serialized event drain extracted from the composition root.
 * Verifies sequential per-queue processing, per-event error isolation, and
 * the single-flight coalescing semantics previously inlined in main().
 */

import { describe, it, expect, mock } from 'bun:test';
import { processEventQueue, createEventDrain } from './event-drain.ts';
import type { Agent } from '@/agent/types';
import type { IncomingMessage } from '@/extensions/data-source';

/**
 * Mock agent for testing (same shape as src/index.test.ts).
 */
function createMockAgent(overrides?: Partial<Agent>): Agent {
  return {
    processMessage: mock(async (_message: string) => 'mock response'),
    processEvent: mock(async () => 'mock response'),
    getConversationHistory: mock(async () => []),
    getCheckpointState: mock(() => null),
    conversationId: 'test-conv-123',
    ...overrides,
  };
}

function testEvent(content: string): IncomingMessage {
  return {
    source: 'test',
    content,
    metadata: {},
    timestamp: new Date(),
  };
}

describe('processEventQueue', () => {
  it('drains events sequentially in FIFO order', async () => {
    const processed: Array<string> = [];
    const agent = createMockAgent({
      processEvent: mock(async (event: IncomingMessage) => {
        processed.push(event.content);
        return 'ok';
      }),
    });

    const { createEventQueue } = await import('@/extensions/bluesky');
    const queue = createEventQueue(10);
    queue.push(testEvent('first'));
    queue.push(testEvent('second'));
    queue.push(testEvent('third'));

    await processEventQueue(queue, agent, 'test');

    expect(processed).toEqual(['first', 'second', 'third']);
    expect(queue.length).toBe(0);
  });

  it('logs per-event errors and keeps draining subsequent events', async () => {
    const consoleMock = mock((_msg: string) => {});
    const originalError = console.error;
    console.error = consoleMock;
    const agent = createMockAgent({
      processEvent: mock(async (event: IncomingMessage) => {
        if (event.content === 'boom') {
          throw new Error('processing failed');
        }
        return 'ok';
      }),
    });

    const { createEventQueue } = await import('@/extensions/bluesky');
    const queue = createEventQueue(10);
    queue.push(testEvent('boom'));
    queue.push(testEvent('fine'));

    try {
      await processEventQueue(queue, agent, 'test');
    } finally {
      console.error = originalError;
    }

    expect(agent.processEvent).toHaveBeenCalledTimes(2);
    expect(queue.length).toBe(0);
    expect(consoleMock).toHaveBeenCalledWith('test processEvent error: processing failed');
  });

  it('labels responses with the provided source label', async () => {
    const consoleMock = mock((_msg: string) => {});
    const originalLog = console.log;
    console.log = consoleMock;
    const agent = createMockAgent({
      processEvent: mock(async () => 'agent says hi'),
    });

    const { createEventQueue } = await import('@/extensions/bluesky');
    const queue = createEventQueue(10);
    queue.push(testEvent('hello'));

    try {
      await processEventQueue(queue, agent, 'scheduler');
    } finally {
      console.log = originalLog;
    }

    expect(consoleMock).toHaveBeenCalledWith('[scheduler] agent response: agent says hi');
  });
});

describe('createEventDrain', () => {
  it('creates a bounded queue and drains it through the agent', async () => {
    const agent = createMockAgent({ processEvent: mock(async () => 'ok') });
    const drain = createEventDrain({ capacity: 2, agent, sourceLabel: 'test' });

    expect(drain.queue.capacity).toBe(2);

    drain.queue.push(testEvent('a'));
    drain.queue.push(testEvent('b'));
    drain.queue.push(testEvent('c')); // exceeds capacity: drops the oldest

    await drain.drain();

    expect(agent.processEvent).toHaveBeenCalledTimes(2);
    expect(drain.queue.length).toBe(0);
  });

  it('coalesces concurrent drains into one serialized loop', async () => {
    let active = 0;
    let maxActive = 0;
    const agent = createMockAgent({
      processEvent: mock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return 'ok';
      }),
    });

    const drain = createEventDrain({ capacity: 10, agent, sourceLabel: 'test' });
    drain.queue.push(testEvent('a'));
    drain.queue.push(testEvent('b'));

    await Promise.all([drain.drain(), drain.drain()]);

    expect(agent.processEvent).toHaveBeenCalledTimes(2);
    // A second concurrent loop would process both events in parallel.
    expect(maxActive).toBe(1);
  });

  it('resets the in-flight flag after a drain containing event failures', async () => {
    const consoleMock = mock((_msg: string) => {});
    const originalError = console.error;
    console.error = consoleMock;
    const agent = createMockAgent({
      processEvent: mock(async (event: IncomingMessage) => {
        if (event.content === 'boom') {
          throw new Error('processing failed');
        }
        return 'ok';
      }),
    });

    const drain = createEventDrain({ capacity: 10, agent, sourceLabel: 'test' });
    drain.queue.push(testEvent('boom'));
    await drain.drain();

    // If the flag were not reset, this second drain would early-return and
    // the queued event would never reach the agent.
    drain.queue.push(testEvent('fine'));
    try {
      await drain.drain();
    } finally {
      console.error = originalError;
    }

    expect(agent.processEvent).toHaveBeenCalledTimes(2);
    expect(drain.queue.length).toBe(0);
  });

  it('keeps single-flight state per drain (independent queues do not block each other)', async () => {
    const agent = createMockAgent({ processEvent: mock(async () => 'ok') });
    const first = createEventDrain({ capacity: 10, agent, sourceLabel: 'one' });
    const second = createEventDrain({ capacity: 10, agent, sourceLabel: 'two' });

    first.queue.push(testEvent('a'));
    second.queue.push(testEvent('b'));

    await Promise.all([first.drain(), second.drain()]);

    expect(agent.processEvent).toHaveBeenCalledTimes(2);
  });
});
