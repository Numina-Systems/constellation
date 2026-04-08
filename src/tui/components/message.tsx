// pattern: Imperative Shell

import { Box, Text } from 'ink';

type MessageProps = {
  role: 'user' | 'assistant';
  content: string;
};

export function Message({ role, content }: MessageProps) {
  const label = role === 'user' ? 'You:' : 'Assistant:';

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text dimColor>{label}</Text>
      <Text>{content}</Text>
    </Box>
  );
}
