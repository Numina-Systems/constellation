// pattern: Imperative Shell

import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';

type InputAreaProps = {
  onSubmit: (text: string) => void;
  disabled: boolean;
};

export function InputArea({ onSubmit, disabled }: InputAreaProps) {
  const [input, setInput] = React.useState('');

  const handleSubmit = (value: string) => {
    onSubmit(value);
    setInput('');
  };

  if (disabled) {
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text dimColor>{chalk.dim('Processing...')}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="row" marginTop={1}>
      <Text>{chalk.dim('> ')}</Text>
      <TextInput
        value={input}
        onChange={setInput}
        onSubmit={handleSubmit}
        placeholder=""
        focus={true}
      />
    </Box>
  );
}
