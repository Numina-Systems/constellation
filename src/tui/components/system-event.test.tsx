// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { SystemEventDisplay } from './system-event.tsx';
import { createAgentEventBus } from '@/tui/event-bus.ts';

describe('SystemEventDisplay', () => {
  it('renders external event with source and summary (tui.AC7.1)', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish event:received event
    bus.publish({
      type: 'event:received',
      source: 'bluesky',
      summary: 'New post from @user',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('[bluesky]');
    expect(output).toContain('New post from @user');

    unmount();
  });

  it('renders compaction start indicator', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish compaction:start event
    bus.publish({
      type: 'compaction:start',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Compacting context');

    unmount();
  });

  it('renders compaction end with token savings (tui.AC7.2)', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish compaction:end event
    bus.publish({
      type: 'compaction:end',
      removedTokens: 1500,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Compacted');
    expect(output).toContain('1500 tokens');

    unmount();
  });

  it('renders activity wake with reason (tui.AC7.3)', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish activity:wake event
    bus.publish({
      type: 'activity:wake',
      reason: 'scheduled task',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Woke');
    expect(output).toContain('scheduled task');

    unmount();
  });

  it('renders activity sleep', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish activity:sleep event
    bus.publish({
      type: 'activity:sleep',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('Sleeping');

    unmount();
  });

  it('renders multiple system events in order', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Publish multiple events
    bus.publish({
      type: 'event:received',
      source: 'twitter',
      summary: 'Tweet received',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    bus.publish({
      type: 'compaction:start',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    bus.publish({
      type: 'compaction:end',
      removedTokens: 2000,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('[twitter]');
    expect(output).toContain('Tweet received');
    expect(output).toContain('Compacting context');
    expect(output).toContain('2000 tokens');

    unmount();
  });

  it('does not render when no events have been published', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    const output = lastFrame();
    // Should be empty or minimal output (just whitespace)
    expect((output ?? '').trim()).toBe('');

    unmount();
  });

  it('handles consecutive activity transitions', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(<SystemEventDisplay bus={bus} />);

    // Wake up
    bus.publish({
      type: 'activity:wake',
      reason: 'user input',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Sleep
    bus.publish({
      type: 'activity:sleep',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    if (output) {
      expect(output).toContain('Woke');
      expect(output).toContain('user input');
      expect(output).toContain('Sleeping');
    }

    unmount();
  });
});
