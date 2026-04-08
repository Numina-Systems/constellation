// pattern: Imperative Shell

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents } from '@/tui/hooks/use-agent-events.ts';

type ThinkingIndicatorProps = {
  bus: AgentEventBus;
  turnIndex: number;
  collapsed: boolean;
};

export function ThinkingIndicator({ bus, turnIndex, collapsed }: ThinkingIndicatorProps) {
  // Filter for thinking events matching this turn
  const thinkingFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:thinking' }> =>
      event.type === 'stream:thinking' && event.turnIndex === turnIndex,
    [turnIndex]
  );

  const thinkingEvents = useAgentEvents(bus, thinkingFilter);

  // Concatenate all thinking text
  const thinkingText = thinkingEvents.reduce((acc, event) => acc + event.text, '');

  // If no thinking content, render nothing
  if (!thinkingText) {
    return null;
  }

  // Expanded mode: show full thinking text
  if (!collapsed) {
    return (
      <Box flexDirection="column">
        <Text>{chalk.dim('💭 Thinking:')}</Text>
        <Text>{chalk.dim(thinkingText)}</Text>
      </Box>
    );
  }

  // Collapsed mode: show character count summary
  const charCount = thinkingText.length;
  return <Text>{chalk.dim(`💭 Thinking (${charCount} chars)`)}</Text>;
}
