// pattern: Imperative Shell

import React from 'react';
import { Text, Box } from 'ink';
import chalk from 'chalk';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents } from '@/tui/hooks/use-agent-events.ts';

type ThinkingIndicatorProps = {
  bus: AgentEventBus;
  turnIndex: number;
  collapsed: boolean;
};

export function ThinkingIndicator({ bus, turnIndex, collapsed }: ThinkingIndicatorProps) {
  // Memoize the filter to prevent unnecessary re-subscriptions
  const filter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:thinking' }> =>
      event.type === 'stream:thinking' && event.turnIndex === turnIndex,
    [turnIndex]
  );

  const thinkingEvents = useAgentEvents(bus, filter);

  // Accumulate thinking text from all events
  const thinkingText = thinkingEvents.reduce((text, event) => {
    return text + (event.text || '');
  }, '');

  // Render nothing if no thinking content
  if (thinkingText.length === 0) {
    return null;
  }

  // Collapsed mode: show character count
  if (collapsed) {
    const charCount = thinkingText.length;
    return (
      <Text>{chalk.dim(`💭 Thinking (${charCount} chars)`)}</Text>
    );
  }

  // Expanded mode: show full thinking text with dimmed styling
  return (
    <Box flexDirection="column">
      <Text>{chalk.dim(`💭 Thinking:`)}</Text>
      <Text>{chalk.dim(thinkingText)}</Text>
    </Box>
  );
}
