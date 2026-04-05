// pattern: Imperative Shell

import { Box, Text } from 'ink';
import chalk from 'chalk';
import type { AgentEventBus } from '@/tui/types.ts';
import { Message } from './message.tsx';
import { StreamingText } from './streaming-text.tsx';
import { ToolCallGroup } from './tool-call-group.tsx';
import { ThinkingIndicator } from './thinking-indicator.tsx';

// Display-only collapsed summary for completed turns with tools
function CollapsedToolSummary({
  toolCount,
  toolErrorCount,
}: {
  toolCount: number;
  toolErrorCount: number;
}) {
  if (toolCount === 0) {
    return null;
  }

  if (toolErrorCount > 0) {
    return <Text>{chalk.dim(`⚠ ${toolCount} tool calls (${toolErrorCount} failed)`)}</Text>;
  }

  return <Text>{chalk.dim(`✓ ${toolCount} tool calls`)}</Text>;
}

// Display-only collapsed summary for completed turns with thinking
function CollapsedThinkingSummary({ charCount }: { charCount: number }) {
  if (charCount === 0) {
    return null;
  }

  return <Text>{chalk.dim(`💭 Thinking (${charCount} chars)`)}</Text>;
}

type CompletedTurn = {
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
          <CollapsedThinkingSummary charCount={message.thinkingCharCount} />
          <CollapsedToolSummary toolCount={message.toolCount} toolErrorCount={message.toolErrorCount} />
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
