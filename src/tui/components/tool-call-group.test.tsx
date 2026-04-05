// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { createAgentEventBus } from '@/tui/event-bus.ts';
import { ToolCallGroup } from './tool-call-group.tsx';

describe('ToolCallGroup', () => {
  it('renders nothing when no tool events have been received', () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={false} />
    );

    const output = lastFrame();
    expect(output).toBe('');

    unmount();
  });

  it('displays individual ToolCall items when expanded and tools are running or completed', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish tool:start event
    bus.publish({
      type: 'tool:start',
      toolName: 'search',
      toolId: 'tool-1',
      input: { query: 'test' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    let output = lastFrame();
    expect(output).toContain('search');

    // Publish tool:result event
    bus.publish({
      type: 'tool:result',
      toolId: 'tool-1',
      result: 'Found 3 items',
      isError: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    output = lastFrame();
    expect(output).toContain('✓');
    expect(output).toContain('search');
    expect(output).toContain('Found 3 items');

    unmount();
  });

  it('shows error indicator when a tool fails', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish tool:start event
    bus.publish({
      type: 'tool:start',
      toolName: 'fetch',
      toolId: 'tool-1',
      input: { url: 'https://example.com' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Publish error result
    bus.publish({
      type: 'tool:result',
      toolId: 'tool-1',
      result: 'Network timeout',
      isError: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('✗');
    expect(output).toContain('fetch');
    expect(output).toContain('Network timeout');

    unmount();
  });

  it('shows summary line when collapsed and tools are present', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={true} />
    );

    // Publish tool:start event
    bus.publish({
      type: 'tool:start',
      toolName: 'search',
      toolId: 'tool-1',
      input: { query: 'test' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Complete the tool
    bus.publish({
      type: 'tool:result',
      toolId: 'tool-1',
      result: 'Done',
      isError: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('1 tool calls');

    unmount();
  });

  it('handles multiple tools in a single turn', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={false} />
    );

    // Publish two tool:start events
    bus.publish({
      type: 'tool:start',
      toolName: 'search',
      toolId: 'tool-1',
      input: { query: 'test' },
    });

    bus.publish({
      type: 'tool:start',
      toolName: 'fetch',
      toolId: 'tool-2',
      input: { url: 'https://example.com' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    let output = lastFrame();
    expect(output).toContain('search');
    expect(output).toContain('fetch');

    // Complete both tools
    bus.publish({
      type: 'tool:result',
      toolId: 'tool-1',
      result: 'Found 3 items',
      isError: false,
    });

    bus.publish({
      type: 'tool:result',
      toolId: 'tool-2',
      result: 'Status 200',
      isError: false,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    output = lastFrame();
    expect(output).toContain('✓');
    expect(output).toContain('search');
    expect(output).toContain('fetch');

    unmount();
  });

  it('shows failure count in collapsed summary when tools fail', async () => {
    const bus = createAgentEventBus();
    const { lastFrame, unmount } = render(
      <ToolCallGroup bus={bus} turnIndex={0} collapsed={true} />
    );

    // Publish two tool events
    bus.publish({
      type: 'tool:start',
      toolName: 'search',
      toolId: 'tool-1',
      input: { query: 'test' },
    });

    bus.publish({
      type: 'tool:start',
      toolName: 'fetch',
      toolId: 'tool-2',
      input: { url: 'https://example.com' },
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Complete one successfully, fail one
    bus.publish({
      type: 'tool:result',
      toolId: 'tool-1',
      result: 'Found 3 items',
      isError: false,
    });

    bus.publish({
      type: 'tool:result',
      toolId: 'tool-2',
      result: 'Network timeout',
      isError: true,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame();
    expect(output).toContain('⚠');
    expect(output).toContain('2 tool calls');
    expect(output).toContain('1 failed');

    unmount();
  });
});
