// pattern: Imperative Shell

import React from 'react';
import { Box, useApp, render } from 'ink';
import type { Agent } from '@/agent/types.ts';
import type { AgentEventBus } from '@/tui/types.ts';
import { StatusBar } from './components/status-bar.tsx';
import { ConversationView } from './components/conversation-view.tsx';
import { InputArea } from './components/input-area.tsx';
import { useAgentEvents } from './hooks/use-agent-events.ts';
import type { AgentEvent } from './types.ts';

type AppProps = {
  agent: Agent;
  bus: AgentEventBus;
  modelName: string;
};

type Message = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  hadTools: boolean;
  hadThinking: boolean;
  turnIndex: number;
};

export function App({ agent, bus, modelName }: AppProps) {
  const [messages, setMessages] = React.useState<Array<Message>>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [turnIndex, setTurnIndex] = React.useState(0);
  const currentTurnTextRef = React.useRef('');
  const lastProcessedTurnStartRef = React.useRef(-1);
  const lastProcessedTurnEndRef = React.useRef(-1);
  const messageIdCounterRef = React.useRef(0);
  useApp();

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

  const toolStartFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'tool:start' }> =>
      event.type === 'tool:start',
    []
  );

  const thinkingFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'stream:thinking' }> =>
      event.type === 'stream:thinking',
    []
  );

  // Subscribe to turn events
  const turnStartEvents = useAgentEvents(bus, turnStartFilter);
  const streamChunkEvents = useAgentEvents(bus, streamChunkFilter);
  const turnEndEvents = useAgentEvents(bus, turnEndFilter);
  const toolStartEvents = useAgentEvents(bus, toolStartFilter);
  const thinkingEvents = useAgentEvents(bus, thinkingFilter);

  // Handle turn:start events
  React.useEffect(() => {
    for (let i = lastProcessedTurnStartRef.current + 1; i < turnStartEvents.length; i++) {
      setIsProcessing(true);
      setTurnIndex((prev) => prev + 1);
      currentTurnTextRef.current = '';
    }
    lastProcessedTurnStartRef.current = turnStartEvents.length - 1;
  }, [turnStartEvents]);

  // Handle stream:chunk events - accumulate text for the current turn in ref
  React.useEffect(() => {
    if (streamChunkEvents.length > 0) {
      currentTurnTextRef.current = streamChunkEvents.reduce((text, chunk) => text + (chunk.text || ''), '');
    }
  }, [streamChunkEvents]);

  // Handle turn:end events - capture the accumulated text
  React.useEffect(() => {
    for (let i = lastProcessedTurnEndRef.current + 1; i < turnEndEvents.length; i++) {
      setIsProcessing(false);
      // Capture the current turn text from the ref
      if (currentTurnTextRef.current.length > 0) {
        const messageId = messageIdCounterRef.current++;
        // Check if this turn had tools or thinking events
        const hadTools = toolStartEvents.length > 0;
        const hadThinking = thinkingEvents.some((e) => e.turnIndex === turnIndex);
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            content: currentTurnTextRef.current,
            hadTools,
            hadThinking,
            turnIndex,
          },
        ]);
      }
      currentTurnTextRef.current = '';
    }
    lastProcessedTurnEndRef.current = turnEndEvents.length - 1;
  }, [turnEndEvents, toolStartEvents, thinkingEvents, turnIndex]);

  const handleSubmit = (text: string) => {
    // Add user message to conversation with unique ID
    const messageId = messageIdCounterRef.current++;
    setMessages((prev) => [
      ...prev,
      {
        id: messageId,
        role: 'user',
        content: text,
        hadTools: false,
        hadThinking: false,
        turnIndex: turnIndex,
      },
    ]);
    // Call agent to process the message (fire-and-forget)
    agent.processMessage(text).catch((error) => {
      console.error('Failed to process message:', error);
    });
  };

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
  waitUntilExit: () => Promise<unknown>;
  unmount: () => void;
} {
  const result = render(<App {...props} />);
  return {
    waitUntilExit: () => result.waitUntilExit(),
    unmount: result.unmount,
  };
}
