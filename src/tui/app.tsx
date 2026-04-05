// pattern: Imperative Shell

import React from 'react';
import { Box, useApp, render } from 'ink';
import type { Agent } from '@/agent/types.ts';
import type { MemoryManager } from '@/memory/manager.ts';
import type { AgentEventBus } from '@/tui/types.ts';
import { StatusBar } from './components/status-bar.tsx';
import { ConversationView } from './components/conversation-view.tsx';
import { InputArea } from './components/input-area.tsx';
import { MutationPrompt } from './components/mutation-prompt.tsx';
import { SystemEventDisplay } from './components/system-event.tsx';
import { useAgentEvents } from './hooks/use-agent-events.ts';
import { createMutationPromptViaBus } from './mutation-bridge.ts';
import { processPendingMutations } from '@/index.ts';
import type { AgentEvent } from './types.ts';

type AppProps = {
  agent: Agent;
  memory: MemoryManager;
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
  toolCount: number;
  toolErrorCount: number;
  thinkingCharCount: number;
};

export function App({ agent, memory, bus, modelName }: AppProps) {
  const [messages, setMessages] = React.useState<Array<Message>>([]);
  const [isProcessing, setIsProcessing] = React.useState(false);
  const [isMutationPromptActive, setIsMutationPromptActive] = React.useState(false);
  const [turnIndex, setTurnIndex] = React.useState(0);
  const currentTurnTextRef = React.useRef('');
  const lastProcessedTurnStartRef = React.useRef(-1);
  const lastProcessedTurnEndRef = React.useRef(-1);
  const messageIdCounterRef = React.useRef(0);
  const currentTurnHadToolsRef = React.useRef(false);
  const currentTurnHadThinkingRef = React.useRef(false);
  const currentTurnToolCountRef = React.useRef(0);
  const currentTurnToolErrorCountRef = React.useRef(0);
  const currentTurnThinkingTextRef = React.useRef('');
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

  const toolResultFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'tool:result' }> =>
      event.type === 'tool:result',
    []
  );

  const mutationRequestFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'mutation:request' }> =>
      event.type === 'mutation:request',
    []
  );

  const mutationResponseFilter = React.useCallback(
    (event: AgentEvent): event is Extract<AgentEvent, { type: 'mutation:response' }> =>
      event.type === 'mutation:response',
    []
  );

  // Subscribe to turn events
  const turnStartEvents = useAgentEvents(bus, turnStartFilter);
  const mutationRequestEvents = useAgentEvents(bus, mutationRequestFilter);
  const mutationResponseEvents = useAgentEvents(bus, mutationResponseFilter);
  const streamChunkEvents = useAgentEvents(bus, streamChunkFilter);
  const turnEndEvents = useAgentEvents(bus, turnEndFilter);
  const toolStartEvents = useAgentEvents(bus, toolStartFilter);
  const toolResultEvents = useAgentEvents(bus, toolResultFilter);
  const thinkingEvents = useAgentEvents(bus, thinkingFilter);

  // Handle turn:start events
  React.useEffect(() => {
    for (let i = lastProcessedTurnStartRef.current + 1; i < turnStartEvents.length; i++) {
      setIsProcessing(true);
      setTurnIndex((prev) => prev + 1);
      currentTurnTextRef.current = '';
      currentTurnHadToolsRef.current = false;
      currentTurnHadThinkingRef.current = false;
      currentTurnToolCountRef.current = 0;
      currentTurnToolErrorCountRef.current = 0;
      currentTurnThinkingTextRef.current = '';
    }
    lastProcessedTurnStartRef.current = turnStartEvents.length - 1;
  }, [turnStartEvents]);

  // Track mutation prompt active state
  React.useEffect(() => {
    if (mutationRequestEvents.length > mutationResponseEvents.length) {
      setIsMutationPromptActive(true);
    } else {
      setIsMutationPromptActive(false);
    }
  }, [mutationRequestEvents, mutationResponseEvents]);

  // Handle stream:chunk events - accumulate text for the current turn in ref
  React.useEffect(() => {
    if (streamChunkEvents.length > 0) {
      currentTurnTextRef.current = streamChunkEvents.reduce((text, chunk) => text + (chunk.text || ''), '');
    }
  }, [streamChunkEvents]);

  // Track if current turn has tools or thinking, and count them
  React.useEffect(() => {
    if (toolStartEvents.length > 0) {
      currentTurnHadToolsRef.current = true;
      currentTurnToolCountRef.current = toolStartEvents.length;
    }
  }, [toolStartEvents]);

  React.useEffect(() => {
    const thinkingForCurrentTurn = thinkingEvents.filter((e) => e.turnIndex === turnIndex);
    if (thinkingForCurrentTurn.length > 0) {
      currentTurnHadThinkingRef.current = true;
      currentTurnThinkingTextRef.current = thinkingForCurrentTurn.reduce((text, e) => text + e.text, '');
    }
  }, [thinkingEvents, turnIndex]);

  // Track tool error counts
  React.useEffect(() => {
    const errorCount = toolResultEvents.filter((e) => e.isError).length;
    if (errorCount > 0) {
      currentTurnToolErrorCountRef.current = errorCount;
    }
  }, [toolResultEvents]);

  // Handle turn:end events - capture the accumulated text
  React.useEffect(() => {
    for (let i = lastProcessedTurnEndRef.current + 1; i < turnEndEvents.length; i++) {
      setIsProcessing(false);
      // Capture the current turn text from the ref
      if (currentTurnTextRef.current.length > 0) {
        const messageId = messageIdCounterRef.current++;
        // Use per-turn tracking refs instead of accumulated event arrays
        const hadTools = currentTurnHadToolsRef.current;
        const hadThinking = currentTurnHadThinkingRef.current;
        setMessages((prev) => [
          ...prev,
          {
            id: messageId,
            role: 'assistant',
            content: currentTurnTextRef.current,
            hadTools,
            hadThinking,
            turnIndex,
            toolCount: currentTurnToolCountRef.current,
            toolErrorCount: currentTurnToolErrorCountRef.current,
            thinkingCharCount: currentTurnThinkingTextRef.current.length,
          },
        ]);
      }
      currentTurnTextRef.current = '';
    }
    lastProcessedTurnEndRef.current = turnEndEvents.length - 1;
  }, [turnEndEvents, turnIndex]);

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
        toolCount: 0,
        toolErrorCount: 0,
        thinkingCharCount: 0,
      },
    ]);
    // Call agent to process the message, then handle mutations
    agent.processMessage(text).then(async () => {
      // Create mutation prompt callback and process mutations
      const mutationCallback = createMutationPromptViaBus(bus);
      await processPendingMutations(memory, mutationCallback);
    }).catch((error) => {
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
        <SystemEventDisplay bus={bus} />
      </Box>
      <MutationPrompt bus={bus} />
      <InputArea onSubmit={handleSubmit} disabled={isProcessing || isMutationPromptActive} />
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
