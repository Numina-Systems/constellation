// pattern: Imperative Shell

import { Box } from 'ink';
import type { AgentEventBus } from '@/tui/types.ts';
import { Message } from './message.tsx';
import { StreamingText } from './streaming-text.tsx';
import { ToolCallGroup } from './tool-call-group.tsx';
import { ThinkingIndicator } from './thinking-indicator.tsx';

type CompletedTurn = {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  hadTools: boolean;
  hadThinking: boolean;
  turnIndex: number;
};

type ConversationViewProps = {
  bus: AgentEventBus;
  messages: ReadonlyArray<CompletedTurn>;
  isStreaming: boolean;
  currentTurnIndex: number;
};

export function ConversationView({
  bus,
  messages,
  isStreaming,
  currentTurnIndex,
}: ConversationViewProps) {
  return (
    <Box flexDirection="column">
      {messages.map((message) => (
        <Box key={message.id} flexDirection="column">
          <Message role={message.role} content={message.content} />
          {message.hadThinking && (
            <ThinkingIndicator bus={bus} turnIndex={message.turnIndex} collapsed={true} />
          )}
          {message.hadTools && (
            <ToolCallGroup bus={bus} turnIndex={message.turnIndex} collapsed={true} />
          )}
        </Box>
      ))}
      {isStreaming && (
        <Box flexDirection="column">
          <ThinkingIndicator bus={bus} turnIndex={currentTurnIndex} collapsed={false} />
          <StreamingText bus={bus} turnIndex={currentTurnIndex} />
          <ToolCallGroup bus={bus} turnIndex={currentTurnIndex} collapsed={false} />
        </Box>
      )}
    </Box>
  );
}
