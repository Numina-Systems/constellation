// pattern: Imperative Shell

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents } from '@/tui/hooks/use-agent-events.ts';
import { ToolCall, type ToolCallStatus } from './tool-call.tsx';

type ToolCallEntry = {
  toolName: string;
  status: ToolCallStatus;
  result?: string;
  error?: string;
};

type ToolCallGroupProps = {
  bus: AgentEventBus;
  turnIndex: number;
  collapsed: boolean;
};

export function ToolCallGroup({ bus, collapsed }: ToolCallGroupProps) {
  // Filter for tool:start events (note: tool:start doesn't have turnIndex in current schema)
  const startFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'tool:start' }> =>
      event.type === 'tool:start',
    []
  );

  const startEvents = useAgentEvents(bus, startFilter);

  // Filter for tool:result events (note: tool:result doesn't have turnIndex in current schema)
  const resultFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'tool:result' }> =>
      event.type === 'tool:result',
    []
  );

  const resultEvents = useAgentEvents(bus, resultFilter);

  // Build map of tool calls by toolId
  const toolCallMap = new Map<string, ToolCallEntry>();

  // Initialize from start events
  for (const event of startEvents) {
    if (!toolCallMap.has(event.toolId)) {
      toolCallMap.set(event.toolId, {
        toolName: event.toolName,
        status: 'running',
      });
    }
  }

  // Update from result events
  for (const event of resultEvents) {
    const existing = toolCallMap.get(event.toolId);
    if (existing) {
      toolCallMap.set(event.toolId, {
        ...existing,
        status: event.isError ? 'error' : 'complete',
        error: event.isError ? event.result : undefined,
        result: !event.isError ? event.result : undefined,
      });
    }
  }

  // If no tool events, render nothing
  if (toolCallMap.size === 0) {
    return null;
  }

  // Count tools and errors for summary
  const toolCount = toolCallMap.size;
  const errorCount = Array.from(toolCallMap.values()).filter((t) => t.status === 'error').length;

  // Expanded mode: show all individual tool calls
  if (!collapsed) {
    const entries = Array.from(toolCallMap.entries());
    return (
      <Box flexDirection="column">
        {entries.map(([toolId, entry]) => (
          <ToolCall
            key={toolId}
            toolId={toolId}
            toolName={entry.toolName}
            status={entry.status}
            resultSummary={entry.result}
            errorMessage={entry.error}
          />
        ))}
      </Box>
    );
  }

  // Collapsed mode: show summary
  if (errorCount > 0) {
    return <Text>{chalk.dim(`⚠ ${toolCount} tool calls (${errorCount} failed)`)}</Text>;
  }

  return <Text>{chalk.dim(`✓ ${toolCount} tool calls`)}</Text>;
}
