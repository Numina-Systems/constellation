// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { ThinkingIndicator } from './thinking-indicator.tsx';

describe('ThinkingIndicator', () => {
  it('renders nothing when no thinking events', () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    const output = lastFrame();
    expect(output).toBe('');

    unmount();
  });

  it('renders dimmed thinking text when expanded', async () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish thinking event
    bus.publish({
      type: 'stream:thinking',
      text: 'Let me think about this carefully',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('💭 Thinking:');
    expect(output).toContain('Let me think about this carefully');

    unmount();
  });

  it('renders collapsed summary with character count', async () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />
    );

    // Publish thinking event
    const thinkingText = 'This is a test';
    bus.publish({
      type: 'stream:thinking',
      text: thinkingText,
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('💭 Thinking');
    expect(output).toContain(`${thinkingText.length} chars`);

    unmount();
  });

  it('accumulates multiple thinking chunks into continuous text', async () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish multiple thinking chunks
    bus.publish({
      type: 'stream:thinking',
      text: 'First ',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'second ',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'third',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('First second third');

    unmount();
  });

  it('only includes thinking events from the matching turn', async () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={1} collapsed={false} />
    );

    // Publish thinking events for different turns
    bus.publish({
      type: 'stream:thinking',
      text: 'Turn 0 thinking',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'Turn 1 thinking',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Turn 1 thinking');
    expect(output).not.toContain('Turn 0 thinking');

    unmount();
  });

  it('collapsed summary displays correct character count with multiple chunks', async () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />
    );

    // Publish multiple chunks
    bus.publish({
      type: 'stream:thinking',
      text: 'abc',
      turnIndex: 0,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'def',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    // Total: 6 chars
    expect(output).toContain('6 chars');

    unmount();
  });
});
