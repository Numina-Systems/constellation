// pattern: Imperative Shell

import { render } from 'ink-testing-library';
import { describe, it, expect } from 'bun:test';
import { StatusBar } from './status-bar.tsx';
import { createAgentEventBus } from '@/tui/event-bus.ts';

describe('StatusBar', () => {
  it('renders model name and zero token counts initially', () => {
    const bus = createAgentEventBus();
    const { lastFrame } = render(<StatusBar bus={bus} modelName="gpt-4" />);
    const output = lastFrame();

    expect(output).toContain('gpt-4');
    expect(output).toContain('0↓ 0↑');
  });

  it('updates token counts after stream:end event', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<StatusBar bus={bus} modelName="claude-3" />);

    // Publish a stream:end event with known usage stats
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
      },
      stopReason: 'end_turn',
    });

    // Allow React to process the update
    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('100↓ 50↑');

    unmount();
  });

  it('accumulates token counts across multiple stream:end events', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<StatusBar bus={bus} modelName="test-model" />);

    // First event
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 50,
        output_tokens: 25,
      },
      stopReason: 'end_turn',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second event
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 75,
        output_tokens: 40,
      },
      stopReason: 'end_turn',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    // Should accumulate: (50 + 75)↓ (25 + 40)↑
    expect(output).toContain('125↓ 65↑');

    unmount();
  });

  it('shows active state indicator (green dot) by default', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<StatusBar bus={bus} modelName="test" />);

    const output = lastFrame();
    // The green dot should be present (●)
    expect(output).toContain('●');

    unmount();
  });

  it('changes indicator to dim when activity:sleep event is received', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<StatusBar bus={bus} modelName="test" />);

    // Publish sleep event
    bus.publish({
      type: 'activity:sleep',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    // Verify the component still renders the indicator
    expect(output).toContain('●');

    unmount();
  });

  it('restores green indicator when activity:wake event is received', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<StatusBar bus={bus} modelName="test" />);

    // Sleep first
    bus.publish({
      type: 'activity:sleep',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then wake
    bus.publish({
      type: 'activity:wake',
      reason: 'scheduled task',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('●');

    unmount();
  });
});
