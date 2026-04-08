// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { StreamingText } from './streaming-text.tsx';

describe('StreamingText', () => {
  it('accumulates stream:chunk events into displayed text', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} />
    );

    // Initially no chunks
    let output = lastFrame();
    expect(output).not.toContain('Hello');
    expect(output).not.toContain('world');

    // Publish both chunks rapidly
    bus.publish({
      type: 'stream:chunk',
      text: 'Hello',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:chunk',
      text: ' world',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    output = lastFrame();
    expect(output).toContain('Hello world');

    unmount();
  });

  it('renders nothing before any chunks arrive', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} />
    );

    const output = lastFrame();
    expect(output).toBe('');

    unmount();
  });

  it('accumulates multiple chunks in order', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <StreamingText bus={bus} />
    );

    bus.publish({ type: 'stream:chunk', text: 'The ', turnIndex: 0 });
    bus.publish({ type: 'stream:chunk', text: 'quick ', turnIndex: 0 });
    bus.publish({ type: 'stream:chunk', text: 'brown ', turnIndex: 0 });
    bus.publish({ type: 'stream:chunk', text: 'fox', turnIndex: 0 });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('The quick brown fox');

    unmount();
  });
});
