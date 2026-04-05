// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { ConversationView } from './conversation-view.tsx';

describe('ConversationView', () => {
  it('renders completed messages with distinct role labels', async () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Hello', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 2, role: 'assistant' as const, content: 'Hi there!', hadTools: false, hadThinking: false, turnIndex: 1, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
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
    const messages = [{ id: 1, role: 'user' as const, content: 'Tell me a story', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 }];

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
      { id: 1, role: 'user' as const, content: 'First question', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 2, role: 'assistant' as const, content: 'First answer', hadTools: false, hadThinking: false, turnIndex: 1, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 3, role: 'user' as const, content: 'Second question', hadTools: false, hadThinking: false, turnIndex: 2, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 4, role: 'assistant' as const, content: 'Second answer', hadTools: false, hadThinking: false, turnIndex: 3, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
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
      { id: 1, role: 'user' as const, content: 'Hello', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
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

  it('renders completed turns with tool summary when hadTools is true', () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Search for info', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 2, role: 'assistant' as const, content: 'Found results', hadTools: true, hadThinking: false, turnIndex: 1, toolCount: 3, toolErrorCount: 0, thinkingCharCount: 0 },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={false}
        currentTurnIndex={1}
      />
    );

    const output = lastFrame();
    expect(output).toContain('Found results');
    expect(output).toContain('✓ 3 tool calls');

    unmount();
  });

  it('renders completed turns with thinking summary when hadThinking is true', () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Complex query', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 2, role: 'assistant' as const, content: 'Analyzed', hadTools: false, hadThinking: true, turnIndex: 1, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 243 },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={false}
        currentTurnIndex={1}
      />
    );

    const output = lastFrame();
    expect(output).toContain('Analyzed');
    expect(output).toContain('💭 Thinking (243 chars)');

    unmount();
  });

  it('renders completed turns with both tool and thinking summaries', () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Complex task', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
      { id: 2, role: 'assistant' as const, content: 'Result', hadTools: true, hadThinking: true, turnIndex: 1, toolCount: 2, toolErrorCount: 1, thinkingCharCount: 512 },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={false}
        currentTurnIndex={1}
      />
    );

    const output = lastFrame();
    expect(output).toContain('Result');
    expect(output).toContain('💭 Thinking (512 chars)');
    expect(output).toContain('⚠ 2 tool calls (1 failed)');

    unmount();
  });

  it('renders streaming tool and thinking components with live updates', async () => {
    const bus = createAgentEventBus();
    const messages = [
      { id: 1, role: 'user' as const, content: 'Stream me', hadTools: false, hadThinking: false, turnIndex: 0, toolCount: 0, toolErrorCount: 0, thinkingCharCount: 0 },
    ];

    const { lastFrame, unmount } = render(
      <ConversationView
        bus={bus}
        messages={messages}
        isStreaming={true}
        currentTurnIndex={1}
      />
    );

    // Publish thinking event
    bus.publish({
      type: 'stream:thinking',
      text: 'Let me think about this carefully',
      turnIndex: 1,
    });

    // Publish tool:start event
    bus.publish({
      type: 'tool:start',
      toolName: 'search',
      toolId: 'tool-1',
      input: {},
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    // Should contain thinking and tool indicators
    expect(output).toContain('💭 Thinking:');
    expect(output).toContain('Let me think about this carefully');
    expect(output).toContain('search');

    unmount();
  });
});
