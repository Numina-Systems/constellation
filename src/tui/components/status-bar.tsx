// pattern: Imperative Shell

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { AgentEventBus } from '@/tui/types.ts';
import { useLatestAgentEvent } from '@/tui/hooks/use-agent-events.ts';

interface StatusBarProps {
  bus: AgentEventBus;
  modelName: string;
}

export function StatusBar({ bus, modelName }: StatusBarProps) {
  const [totalInputTokens, setTotalInputTokens] = React.useState(0);
  const [totalOutputTokens, setTotalOutputTokens] = React.useState(0);

  const streamEndEvent = useLatestAgentEvent(bus, (event) => event.type === 'stream:end');
  const activityEvent = useLatestAgentEvent(
    bus,
    (event) => event.type === 'activity:wake' || event.type === 'activity:sleep'
  );

  React.useEffect(() => {
    if (streamEndEvent) {
      setTotalInputTokens((prev) => prev + streamEndEvent.usage.input_tokens);
      setTotalOutputTokens((prev) => prev + streamEndEvent.usage.output_tokens);
    }
  }, [streamEndEvent]);

  const isActive = activityEvent ? activityEvent.type === 'activity:wake' : true;
  const activityDot = isActive ? chalk.green('●') : chalk.gray('●');

  return (
    <Box flexDirection="row" justifyContent="space-between" paddingBottom={1}>
      <Text dimColor>{modelName}</Text>
      <Text>
        {chalk.dim(`${totalInputTokens}↓ ${totalOutputTokens}↑`)}
      </Text>
      <Text>{activityDot}</Text>
    </Box>
  );
}
