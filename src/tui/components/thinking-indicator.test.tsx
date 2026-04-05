// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { ThinkingIndicator } from './thinking-indicator.tsx';

describe('ThinkingIndicator', () => {
  it('renders thinking content with dimmed styling when collapsed is false', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish thinking events
    bus.publish({
      type: 'stream:thinking',
      text: 'Let me think about this problem.',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Let me think about this problem.');

    unmount();
  });

  it('accumulates multiple thinking chunks into continuous text', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={1} collapsed={false} />
    );

    // Publish multiple thinking chunks
    bus.publish({
      type: 'stream:thinking',
      text: 'First thought ',
      turnIndex: 1,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'second thought ',
      turnIndex: 1,
    });

    bus.publish({
      type: 'stream:thinking',
      text: 'final thought',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('First thought second thought final thought');

    unmount();
  });

  it('ignores thinking events with different turnIndex', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish thinking from different turn
    bus.publish({
      type: 'stream:thinking',
      text: 'wrong turn',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).not.toContain('wrong turn');

    // Publish matching turn
    bus.publish({
      type: 'stream:thinking',
      text: 'correct turn',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lastFrame()).toContain('correct turn');

    unmount();
  });

  it('renders nothing when no thinking events', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    const output = lastFrame();
    expect(output).toBe('');

    unmount();
  });

  it('renders collapsed summary with character count when collapsed is true', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />
    );

    // Publish thinking content
    bus.publish({
      type: 'stream:thinking',
      text: 'This is a long thinking block with many characters to test the character counting logic.',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    // Should contain character count indicator
    expect(output).toContain('chars');
    // Should not contain full thinking text
    expect(output).not.toContain('This is a long thinking block');

    unmount();
  });

  it('displays correct character count in collapsed mode', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />
    );

    const thinkingText = 'Hello world';
    bus.publish({
      type: 'stream:thinking',
      text: thinkingText,
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('11 chars');

    unmount();
  });

  it('renders nothing when collapsed and no thinking events', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />
    );

    const output = lastFrame();
    expect(output).toBe('');

    unmount();
  });

  it('switches from expanded to collapsed view', async () => {
    const bus = createAgentEventBus();
    const { rerender, lastFrame, unmount } = render(
      <ThinkingIndicator bus={bus} turnIndex={0} collapsed={false} />
    );

    bus.publish({
      type: 'stream:thinking',
      text: 'Test thinking content for mode switching.',
      turnIndex: 0,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    let output = lastFrame();
    expect(output).toContain('Test thinking content');

    // Re-render with collapsed={true}
    rerender(<ThinkingIndicator bus={bus} turnIndex={0} collapsed={true} />);

    await new Promise((resolve) => setTimeout(resolve, 50));

    output = lastFrame();
    // Should show collapsed format
    expect(output).toContain('chars');
    // Should not show full text
    expect(output).not.toContain('Test thinking content');

    unmount();
  });
});
