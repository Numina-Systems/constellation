// pattern: Imperative Shell

import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { useAgentEvents } from '@/tui/hooks/use-agent-events.ts';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';

type SystemEventDisplayProps = {
  bus: AgentEventBus;
};

type SystemEventEntry = {
  id: string;
  message: string;
};

export function SystemEventDisplay({ bus }: SystemEventDisplayProps) {
  const [events, setEvents] = React.useState<Array<SystemEventEntry>>([]);

  // Filters for each system event type
  const eventReceivedFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'event:received' }> =>
      event.type === 'event:received',
    []
  );

  const compactionStartFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'compaction:start' }> =>
      event.type === 'compaction:start',
    []
  );

  const compactionEndFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'compaction:end' }> =>
      event.type === 'compaction:end',
    []
  );

  const activityWakeFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'activity:wake' }> =>
      event.type === 'activity:wake',
    []
  );

  const activitySleepFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'activity:sleep' }> =>
      event.type === 'activity:sleep',
    []
  );

  // Subscribe to system events
  const eventReceivedEvents = useAgentEvents(bus, eventReceivedFilter);
  const compactionStartEvents = useAgentEvents(bus, compactionStartFilter);
  const compactionEndEvents = useAgentEvents(bus, compactionEndFilter);
  const activityWakeEvents = useAgentEvents(bus, activityWakeFilter);
  const activitySleepEvents = useAgentEvents(bus, activitySleepFilter);

  // Track which events we've already processed
  const lastProcessedRef = React.useRef({
    eventReceived: -1,
    compactionStart: -1,
    compactionEnd: -1,
    activityWake: -1,
    activitySleep: -1,
  });

  // Process new events
  React.useEffect(() => {
    const newEntries: Array<SystemEventEntry> = [];

    // Process event:received
    for (let i = lastProcessedRef.current.eventReceived + 1; i < eventReceivedEvents.length; i++) {
      const event = eventReceivedEvents[i];
      const message = chalk.gray(`[${event.source}] ${event.summary}`);
      newEntries.push({
        id: `event-received-${i}`,
        message,
      });
    }
    lastProcessedRef.current.eventReceived = eventReceivedEvents.length - 1;

    // Process compaction:start
    for (let i = lastProcessedRef.current.compactionStart + 1; i < compactionStartEvents.length; i++) {
      const message = chalk.gray('⟳ Compacting context...');
      newEntries.push({
        id: `compaction-start-${i}`,
        message,
      });
    }
    lastProcessedRef.current.compactionStart = compactionStartEvents.length - 1;

    // Process compaction:end
    for (let i = lastProcessedRef.current.compactionEnd + 1; i < compactionEndEvents.length; i++) {
      const event = compactionEndEvents[i];
      const message = chalk.gray(`⟳ Compacted — saved ${event.removedTokens} tokens`);
      newEntries.push({
        id: `compaction-end-${i}`,
        message,
      });
    }
    lastProcessedRef.current.compactionEnd = compactionEndEvents.length - 1;

    // Process activity:wake
    for (let i = lastProcessedRef.current.activityWake + 1; i < activityWakeEvents.length; i++) {
      const event = activityWakeEvents[i];
      const message = chalk.gray(`▶ Woke: ${event.reason}`);
      newEntries.push({
        id: `activity-wake-${i}`,
        message,
      });
    }
    lastProcessedRef.current.activityWake = activityWakeEvents.length - 1;

    // Process activity:sleep
    for (let i = lastProcessedRef.current.activitySleep + 1; i < activitySleepEvents.length; i++) {
      const message = chalk.gray('⏸ Sleeping');
      newEntries.push({
        id: `activity-sleep-${i}`,
        message,
      });
    }
    lastProcessedRef.current.activitySleep = activitySleepEvents.length - 1;

    // Add new entries to the list
    if (newEntries.length > 0) {
      setEvents((prev) => [...prev, ...newEntries]);
    }
  }, [eventReceivedEvents, compactionStartEvents, compactionEndEvents, activityWakeEvents, activitySleepEvents]);

  if (events.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" marginY={0}>
      {events.map((entry) => (
        <Text key={entry.id} dimColor>
          {entry.message}
        </Text>
      ))}
    </Box>
  );
}
