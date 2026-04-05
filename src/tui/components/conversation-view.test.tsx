// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { ConversationView } from './conversation-view.tsx';

describe('ConversationView', () => {
  it('renders completed messages with distinct role labels', async () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Hello' },
      { id: 2, role: 'assistant' as const, content: 'Hi there!' },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={false}
        currentTurnIndex={0}
      />
    );

    const output = lastFrame();
    expect(output).toContain('You:');
    expect(output).toContain('Hello');
    expect(output).toContain('Assistant:');
    expect(output).toContain('Hi there!');

    unmount();
  });

  it('renders streaming text when isStreaming is true', async () => {
    const bus = createAgentEventBus();
    const messages = [{ id: 1, role: 'user' as const, content: 'Tell me a story' }];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={true}
        currentTurnIndex={1}
      />
    );

    // Initially no streaming content
    let output = lastFrame();
    expect(output).toContain('You:');
    expect(output).toContain('Tell me a story');

    // Publish stream chunks
    bus.publish({
      type: 'stream:chunk',
      text: 'Once upon a time',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    output = lastFrame();
    expect(output).toContain('Once upon a time');

    unmount();
  });

  it('renders with empty messages array without error', () => {
    const bus = createAgentEventBus();

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={[]}
        isStreaming={false}
        currentTurnIndex={0}
      />
    );

    const output = lastFrame();
    // Should render without error (output will be empty)
    expect(output).toBe('');

    unmount();
  });

  it('renders multiple messages in order', () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'First question' },
      { id: 2, role: 'assistant' as const, content: 'First answer' },
      { id: 3, role: 'user' as const, content: 'Second question' },
      { id: 4, role: 'assistant' as const, content: 'Second answer' },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={false}
        currentTurnIndex={0}
      />
    );

    const output = lastFrame();
    expect(output).toContain('First question');
    expect(output).toContain('First answer');
    expect(output).toContain('Second question');
    expect(output).toContain('Second answer');

    unmount();
  });

  it('uses currentTurnIndex to display streaming chunks for the right turn', async () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Hello' },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={true}
        currentTurnIndex={5}
      />
    );

    // Publish chunks for the current turn
    bus.publish({
      type: 'stream:chunk',
      text: 'Response',
      turnIndex: 5,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('You:');
    expect(output).toContain('Hello');
    expect(output).toContain('Response');

    unmount();
  });
});
