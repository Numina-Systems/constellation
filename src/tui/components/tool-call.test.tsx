// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { ToolCall } from './tool-call.tsx';

describe('ToolCall', () => {
  it('renders running status with spinner and tool name', () => {
    const { lastFrame, unmount } = render(
      <ToolCall toolName="web_search" toolId="123" status="running" />
    );

    const output = lastFrame();
    // Spinner renders but is animated, so just verify tool name is present
    expect(output).toContain('web_search');

    unmount();
  });

  it('renders complete status with checkmark and truncated summary', async () => {
    const { lastFrame, unmount } = render(
      <ToolCall
        toolName="database_query"
        toolId="456"
        status="complete"
        resultSummary="Found 3 items in database"
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame() ?? '';
    expect(output).toContain('✓');
    expect(output).toContain('database_query');
    expect(output).toContain('Found 3 items in database');

    unmount();
  });

  it('truncates long result summaries with ellipsis', async () => {
    const longSummary =
      'This is a very long result summary that should be truncated to approximately eighty characters maximum with an ellipsis at the end';

    const { lastFrame, unmount } = render(
      <ToolCall
        toolName="test_tool"
        toolId="789"
        status="complete"
        resultSummary={longSummary}
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame() ?? '';
    expect(output).toContain('✓');
    expect(output).toContain('test_tool');
    // Should be truncated with ellipsis
    expect(output.length).toBeLessThan(longSummary.length + 20);
    if (longSummary.length > 80) {
      expect(output).toContain('...');
    }

    unmount();
  });

  it('renders error status with cross and error message', async () => {
    const { lastFrame, unmount } = render(
      <ToolCall
        toolName="api_call"
        toolId="999"
        status="error"
        errorMessage="Connection timeout"
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame() ?? '';
    expect(output).toContain('✗');
    expect(output).toContain('api_call');
    expect(output).toContain('Connection timeout');

    unmount();
  });

  it('handles tool names with special characters', async () => {
    const { lastFrame, unmount } = render(
      <ToolCall
        toolName="tool:with:colons"
        toolId="special1"
        status="complete"
        resultSummary="Success"
      />
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const output = lastFrame() ?? '';
    expect(output).toContain('tool:with:colons');

    unmount();
  });
});
