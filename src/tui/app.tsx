// pattern: Imperative Shell

import React from 'react';
import { Box, useApp } from 'ink';
import type { Agent } from '@/agent/types.ts';
import type { AgentEventBus } from '@/tui/types.ts';
import { StatusBar } from './components/status-bar.tsx';
import { ConversationView } from './components/conversation-view.tsx';
import { InputArea } from './components/input-area.tsx';
import { useAgentEvents } from './hooks/use-agent-events.ts';
import type { AgentEvent } from './types.ts';

interface AppProps {
  agent: Agent;
  bus: AgentEventBus;
  modelName: string;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export function App({ agent, bus, modelName }: AppProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [turnIndex, setTurnIndex] = React.useState(0);
  const currentTurnTextRef = React.useRef('');
  const { exit } = useApp();

  // Memoize filters for event subscriptions
  const turnStartFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'turn:start' }> =>
      event.type === 'turn:start',
    []
  );

  const streamChunkFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:chunk' }> =>
      event.type === 'stream:chunk' && event.turnIndex === turnIndex,
    [turnIndex]
  );

  const turnEndFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'turn:end' }> =>
      event.type === 'turn:end',
    []
  );

  // Subscribe to turn events
  const turnStartEvents = useAgentEvents(bus, turnStartFilter);
  const streamChunkEvents = useAgentEvents(bus, streamChunkFilter);
  const turnEndEvents = useAgentEvents(bus, turnEndFilter);

  // Handle turn:start events
  React.useEffect(() => {
    if (turnStartEvents.length > 0) {
      setIsProcessing(true);
      setTurnIndex((prev) => prev + 1);
      currentTurnTextRef.current = '';
    }
  }, [turnStartEvents]);

  // Handle stream:chunk events - accumulate text for the current turn in ref
  React.useEffect(() => {
    if (streamChunkEvents.length > 0) {
      const latestChunk = streamChunkEvents[streamChunkEvents.length - 1];
      if (latestChunk) {
        currentTurnTextRef.current += latestChunk.text || '';
      }
    }
  }, [streamChunkEvents]);

  // Handle turn:end events - capture the accumulated text
  React.useEffect(() => {
    if (turnEndEvents.length > 0) {
      setIsProcessing(false);
      // Capture the current turn text from the ref
      if (currentTurnTextRef.current.length > 0) {
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: currentTurnTextRef.current },
        ]);
      }
      currentTurnTextRef.current = '';
    }
  }, [turnEndEvents]);

  const handleSubmit = (text: string) => {
    // Add user message to conversation
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    // Call agent to process the message (fire-and-forget)
    agent.processMessage(text).catch((error) => {
      console.error('Failed to process message:', error);
    });
  };

  // Handle Ctrl+C to exit (basic exit support for Phase 6)
  React.useEffect(() => {
    // Note: Full Ctrl+C handling will be implemented in Phase 6 with useInput hook
    // For now, just ensure exit is available for cleanup
    void exit;
    return undefined;
  }, [exit]);

  return (
    <Box flexDirection="column" height="100%">
      <StatusBar bus={bus} modelName={modelName} />
      <Box flexGrow={1} flexDirection="column">
        <ConversationView
          bus={bus}
          messages={messages}
          isStreaming={isProcessing}
          currentTurnIndex={turnIndex}
        />
      </Box>
      <InputArea onSubmit={handleSubmit} disabled={isProcessing} />
    </Box>
  );
}

/**
 * Render the App component using Ink's render function.
 * Returns a promise that resolves when the app exits.
 */
export function renderApp(props: AppProps): {
  waitUntilExit: () => Promise<void>;
  unmount: () => void;
} {
  const { render } = require('ink');
  const result = render(<App {...props} />);
  return {
    waitUntilExit: result.waitUntilExit,
    unmount: result.unmount,
  };
}
