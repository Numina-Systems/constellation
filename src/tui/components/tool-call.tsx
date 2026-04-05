// pattern: Imperative Shell

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';

export type ToolCallStatus = 'running' | 'complete' | 'error';

type ToolCallProps = {
  toolName: string;
  toolId: string;
  status: ToolCallStatus;
  resultSummary?: string;
  errorMessage?: string;
};

export function ToolCall({
  toolName,
  status,
  resultSummary,
  errorMessage,
}: ToolCallProps) {
  // Truncate summary to ~80 chars with ellipsis
  const truncateSummary = (text: string, maxLength = 80) => {
    if (text.length <= maxLength) {
      return text;
    }
    return text.slice(0, maxLength) + '...';
  };

  if (status === 'running') {
    return (
      <Box flexDirection="row" gap={1}>
        <Spinner />
        <Text>{toolName}</Text>
      </Box>
    );
  }

  if (status === 'complete') {
    const truncated = resultSummary ? truncateSummary(resultSummary) : '';
    return (
      <Box flexDirection="row" gap={1}>
        <Text>{chalk.green('✓')}</Text>
        <Text>{toolName}</Text>
        {truncated && <Text>{chalk.dim(`— ${truncated}`)}</Text>}
      </Box>
    );
  }

  // status === 'error'
  return (
    <Box flexDirection="row" gap={1}>
      <Text>{chalk.red('✗')}</Text>
      <Text>{toolName}</Text>
      {errorMessage && <Text>{chalk.dim(`— ${errorMessage}`)}</Text>}
    </Box>
  );
}
