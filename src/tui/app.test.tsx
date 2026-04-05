// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from './event-bus.ts';
import { App } from './app.tsx';
import type { Agent } from '@/agent/types.ts';
import type { AgentEventBus } from '@/tui/types.ts';

describe('App integration', () => {
  let bus: AgentEventBus;
  let mockAgent: Agent;

  beforeEach(() => {
    bus = createAgentEventBus();

    // Create a mock agent
    mockAgent = {
      conversationId: 'test-conv-123',
      processMessage: async () => 'response',
      processEvent: async () => '',
      getConversationHistory: async () => [],
    };
  });

  afterEach(() => {
    bus.clear();
  });

  it('AC3.1: renders streaming responses from stream:chunk events', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // Initial render should show input prompt
    let output = lastFrame();
    expect(output).toContain('>');

    // Simulate streaming events on the bus
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.publish({
      type: 'stream:chunk',
      text: 'Hello ',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.publish({
      type: 'stream:chunk',
      text: 'world',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that streaming text appears
    output = lastFrame();
    // StreamingText should render the accumulated chunks
    expect(output).toContain('Hello');

    unmountComponent();
  });

  it('AC3.2: StatusBar updates token counts after stream:end', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // Publish stream:end with usage stats
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 42,
        output_tokens: 73,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Check that token counts are displayed
    const output = lastFrame();
    // Token format is "{inputTokens}↓ {outputTokens}↑"
    expect(output).toContain('42↓');
    expect(output).toContain('73↑');

    unmountComponent();
  });

  it('AC3.3: InputArea disabled during processing, re-enabled after turn:end', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // Initially, input should be enabled (showing prompt)
    let output = lastFrame();
    expect(output).toContain('>');
    expect(output).not.toContain('Processing...');

    // Start processing
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 30));

    // Check that input is disabled
    output = lastFrame();
    expect(output).toContain('Processing...');

    // Simulate turn completion
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });

    bus.publish({
      type: 'turn:end',
      messageCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Input should be re-enabled
    output = lastFrame();
    expect(output).toContain('>');

    unmountComponent();
  });

  it('AC3.4: multiple sequential turns render distinct streaming output', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // First turn: assistant response
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.publish({
      type: 'stream:chunk',
      text: 'First ',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));

    bus.publish({
      type: 'stream:chunk',
      text: 'response',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // At this point we should see 'First response' streaming
    let output = lastFrame();
    expect(output).toContain('First');

    // Complete first turn
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });

    bus.publish({
      type: 'turn:end',
      messageCount: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second turn: another response
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    bus.publish({
      type: 'stream:chunk',
      text: 'Second ',
      turnIndex: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    bus.publish({
      type: 'stream:chunk',
      text: 'response',
      turnIndex: 2,
    });

    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should see 'Second response' now
    output = lastFrame();
    expect(output).toContain('Second');

    unmountComponent();
  });

  it('renders layout with StatusBar, ConversationView, and InputArea', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    const output = lastFrame();

    // Should contain model name (from StatusBar)
    expect(output).toContain('test-model');

    // Should contain input prompt (from InputArea)
    expect(output).toContain('>');

    unmountComponent();
  });

  it('integrates bus events for streaming and status updates', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // Publish a complete turn with streaming and usage
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.publish({
      type: 'stream:chunk',
      text: 'test response',
      turnIndex: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 10));

    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 5,
        output_tokens: 15,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });

    bus.publish({
      type: 'turn:end',
      messageCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Verify both streaming text and token counts
    const output = lastFrame();
    expect(output).toContain('test');
    expect(output).toContain('5↓');
    expect(output).toContain('15↑');

    unmountComponent();
  });

  it('handles processing state transitions correctly', async () => {
    const { lastFrame, unmount: unmountComponent } = render(
      <App agent={mockAgent} bus={bus} modelName="test-model" />
    );

    // Initial state: should have input prompt
    expect(lastFrame()).toContain('>');

    // Publish turn:start
    bus.publish({
      type: 'turn:start',
      source: 'user',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should be processing
    expect(lastFrame()).toContain('Processing...');

    // Complete the turn
    bus.publish({
      type: 'stream:end',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
      stopReason: 'end_turn',
    });

    bus.publish({
      type: 'turn:end',
      messageCount: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 200));

    // Should be back to prompt
    expect(lastFrame()).toContain('>');

    unmountComponent();
  });
});
