// pattern: Imperative Shell

import { Box } from 'ink';
import type { AgentEventBus } from '@/tui/types.ts';
import { Message } from './message.tsx';
import { StreamingText } from './streaming-text.tsx';

interface ConversationViewProps {
  bus: AgentEventBus;
  messages: ReadonlyArray<{ id: number; role: 'user' | 'assistant'; content: string }>;
  isStreaming: boolean;
  currentTurnIndex: number;
}

export function ConversationView({
  bus,
  messages,
  isStreaming,
  currentTurnIndex,
}: ConversationViewProps) {
  return (
    <Box flexDirection="column">
      {messages.map((message) => (
        <Message
          key={message.id}
          role={message.role}
          content={message.content}
        />
      ))}
      {isStreaming && <StreamingText bus={bus} turnIndex={currentTurnIndex} />}
    </Box>
  );
}
