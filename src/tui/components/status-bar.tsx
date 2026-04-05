// pattern: Imperative Shell

import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents, useLatestAgentEvent } from '@/tui/hooks/use-agent-events.ts';

type StatusBarProps = {
  bus: AgentEventBus;
  modelName: string;
};

export function StatusBar({ bus, modelName }: StatusBarProps) {
  const streamEndEvents = useAgentEvents(
    bus,
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:end' }> =>
      event.type === 'stream:end'
  );
  const activityEvent = useLatestAgentEvent(
    bus,
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'activity:wake' } | { type: 'activity:sleep' }> =>
      event.type === 'activity:wake' || event.type === 'activity:sleep'
  );

  // Derive cumulative totals from all stream:end events
  const totalInputTokens = streamEndEvents.reduce((sum, event) => sum + event.usage.input_tokens, 0);
  const totalOutputTokens = streamEndEvents.reduce((sum, event) => sum + event.usage.output_tokens, 0);

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
