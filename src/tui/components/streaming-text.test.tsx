// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { StreamingText } from './streaming-text.tsx';

describe('StreamingText', () => {
  it('accumulates stream:chunk events with matching turnIndex into displayed text', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} turnIndex={1} />
    );

    // Initially no chunks
    let output = lastFrame();
    expect(output).not.toContain('Hello');
    expect(output).not.toContain('world');

    // Publish both chunks rapidly to test batching
    bus.publish({
      type: 'stream:chunk',
      text: 'Hello',
      turnIndex: 1,
    });

    bus.publish({
      type: 'stream:chunk',
      text: ' world',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    output = lastFrame();
    expect(output).toContain('Hello world');

    unmount();
  });

  it('ignores chunks with different turnIndex', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} turnIndex={1} />
    );

    // Publish chunks with different turnIndex
    bus.publish({
      type: 'stream:chunk',
      text: 'wrong',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:chunk',
      text: 'also wrong',
      turnIndex: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).not.toContain('wrong');
    expect(output).not.toContain('also wrong');

    // Publish matching chunk
    bus.publish({
      type: 'stream:chunk',
      text: 'correct',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('correct');

    unmount();
  });

  it('renders nothing before any chunks arrive', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} turnIndex={0} />
    );

    const output = lastFrame();
    // Component should render empty (no text output)
    expect(output).toBe('');

    unmount();
  });

  it('accumulates multiple chunks in order', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} turnIndex={2} />
    );

    // Publish several chunks in rapid sequence (batched)
    bus.publish({
      type: 'stream:chunk',
      text: 'The ',
      turnIndex: 2,
    });

    bus.publish({
      type: 'stream:chunk',
      text: 'quick ',
      turnIndex: 2,
    });

    bus.publish({
      type: 'stream:chunk',
      text: 'brown ',
      turnIndex: 2,
    });

    bus.publish({
      type: 'stream:chunk',
      text: 'fox',
      turnIndex: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('The quick brown fox');

    unmount();
  });

});
