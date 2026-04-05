// pattern: Imperative Shell

/**
 * MutationPrompt component renders an inline approval prompt for pending mutations.
 * Listens for mutation:request events and publishes mutation:response when user responds.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';
import type { AgentEventBus, AgentEvent } from '../types.ts';
import { useLatestAgentEvent } from '../hooks/use-agent-events.ts';

type MutationPromptProps = {
  bus: AgentEventBus;
};

type MutationRequest = Extract<AgentEvent, { type: 'mutation:request' }>;

export function MutationPrompt({ bus }: MutationPromptProps) {
  const [feedbackMode, setFeedbackMode] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [currentRequest, setCurrentRequest] = useState<MutationRequest | null>(
    null,
  );

  // Listen for mutation:request events
  const latestRequest = useLatestAgentEvent(
    bus,
    (event): event is MutationRequest =>
      event.type === 'mutation:request',
  );

  // Update current request when new request arrives
  React.useEffect(() => {
    if (latestRequest) {
      setCurrentRequest(latestRequest);
      setFeedbackMode(false);
      setFeedbackText('');
    }
  }, [latestRequest]);

  const handleApprove = useCallback(() => {
    if (currentRequest) {
      bus.publish({
        type: 'mutation:response',
        mutationId: currentRequest.mutationId,
        approved: true,
      });
      setCurrentRequest(null);
    }
  }, [currentRequest, bus]);

  const handleReject = useCallback(() => {
    if (currentRequest) {
      bus.publish({
        type: 'mutation:response',
        mutationId: currentRequest.mutationId,
        approved: false,
      });
      setCurrentRequest(null);
    }
  }, [currentRequest, bus]);

  const handleFeedbackSubmit = useCallback(() => {
    if (currentRequest) {
      bus.publish({
        type: 'mutation:response',
        mutationId: currentRequest.mutationId,
        approved: false,
        feedback: feedbackText,
      });
      setCurrentRequest(null);
      setFeedbackText('');
      setFeedbackMode(false);
    }
  }, [currentRequest, feedbackText, bus]);

  // Handle keyboard input when not in feedback mode
  useInput((input) => {
    if (!currentRequest || feedbackMode) {
      return;
    }

    const key = input.toLowerCase();
    if (key === 'y') {
      handleApprove();
    } else if (key === 'n') {
      handleReject();
    } else if (key === 'f') {
      setFeedbackMode(true);
    }
  });

  // Don't render anything if no current request
  if (!currentRequest) {
    return null;
  }

  // Truncate proposed content to ~10 lines
  const lines = currentRequest.proposedContent.split('\n');
  const truncated =
    lines.length > 10
      ? lines.slice(0, 10).join('\n') + '\n...'
      : currentRequest.proposedContent;

  if (feedbackMode) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="yellow">
        <Text>
          {chalk.dim(`Block: ${currentRequest.blockId}`)}
        </Text>
        <Box marginY={1} paddingX={1}>
          <Text>{truncated}</Text>
        </Box>
        {currentRequest.reason && (
          <Text>{chalk.dim(`Reason: ${currentRequest.reason}`)}</Text>
        )}
        <Box marginY={1}>
          <Text>Feedback: </Text>
          <TextInput
            value={feedbackText}
            onChange={setFeedbackText}
            onSubmit={handleFeedbackSubmit}
            focus={true}
          />
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan">
      <Text>
        {chalk.dim(`Block: ${currentRequest.blockId}`)}
      </Text>
      <Box marginY={1} paddingX={1}>
        <Text>{truncated}</Text>
      </Box>
      {currentRequest.reason && (
        <Text>{chalk.dim(`Reason: ${currentRequest.reason}`)}</Text>
      )}
      <Box marginY={1}>
        <Text>
          {chalk.cyan('[y] Approve')}
          <Text> • </Text>
          {chalk.cyan('[n] Reject')}
          <Text> • </Text>
          {chalk.cyan('[f] Feedback')}
        </Text>
      </Box>
    </Box>
  );
}
