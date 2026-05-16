// pattern: Imperative Shell

/**
 * Shell execution tool for persistent shell session interaction.
 * Executes commands in a session where environment, working directory,
 * and aliases persist across multiple invocations.
 */

import type {Tool} from '../types';
import type {ShellSession} from '@/shell/index';

export function createShellExecuteTool(session: ShellSession): Tool {
  return {
    definition: {
      name: 'shell_execute',
      description:
        'Execute a command in a persistent shell session. Working directory, environment variables, and aliases persist across calls. This is NOT a fresh subprocess — state accumulates between invocations.',
      parameters: [
        {
          name: 'command',
          type: 'string',
          description: 'The shell command to execute',
          required: true,
        },
      ],
    },
    handler: async (params) => {
      const command = params['command'] as string;
      const result = await session.execute(command);

      const output = [
        result.output,
        result.timedOut ? '' : `[exit code: ${result.exitCode}]`,
        `[cwd: ${result.workingDirectory}]`,
      ]
        .filter(Boolean)
        .join('\n');

      return {
        success: result.exitCode === 0 && !result.timedOut,
        output,
        error: result.timedOut
          ? 'Command timed out'
          : result.exitCode !== 0
            ? `Command exited with code ${result.exitCode}`
            : undefined,
      };
    },
  };
}
