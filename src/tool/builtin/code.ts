// pattern: Imperative Shell

/**
 * execute_code tool definition for sandboxed TypeScript code execution.
 * The actual dispatch is special-cased by the agent loop to route to CodeRuntime.
 * This tool MUST be registered in ToolRegistry so the model knows it exists.
 */

import type { Tool } from '../types.ts';

export function createExecuteCodeTool(): Tool {
  return {
    definition: {
      name: 'execute_code',
      description:
        'Execute TypeScript code in a sandboxed Deno environment. The code can make network requests to allowed hosts, read/write files in the working directory, and call memory tools via the built-in bridge functions. Use this for any capability beyond basic memory operations.',
      parameters: [
        {
          name: 'code',
          type: 'string',
          description: 'TypeScript code to execute',
          required: true,
        },
      ],
    },
    handler: async () => ({
      success: false,
      output: '',
      error: 'execute_code is dispatched by the agent loop, not the tool registry',
    }),
  };
}
