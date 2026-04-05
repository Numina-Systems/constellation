// pattern: Imperative Shell

import React from 'react';
import { Text } from 'ink';
import type { AgentEvent, AgentEventBus } from '@/tui/types.ts';
import { useAgentEvents } from '@/tui/hooks/use-agent-events.ts';

type StreamingTextProps = {
  bus: AgentEventBus;
};

export function StreamingText({ bus }: StreamingTextProps) {
  // Memoize the filter to prevent unnecessary re-subscriptions
  const filter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
      event.type === 'stream:chunk',
    []
  );

  const chunks = useAgentEvents(bus, filter);

  // Accumulate text from all chunks
  const accumulatedText = chunks.reduce((text, chunk) => {
    return text + (chunk.text || '');
  }, '');

  // Render nothing until we have text
  if (accumulatedText.length === 0) {
    return null;
  }

  return <Text>{accumulatedText}</Text>;
}
