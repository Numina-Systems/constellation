// pattern: Imperative Shell

/**
 * compact_context tool definition for agent-initiated conversation history compression.
 * The actual dispatch is special-cased by the agent loop to route to Compactor.
 * This tool MUST be registered in ToolRegistry so the model knows it exists.
 */

import type { Tool } from '../types.ts';

export function createCompactContextTool(): Tool {
  return {
    definition: {
      name: 'compact_context',
      description: 'Compress conversation history to free up context space.',
      parameters: [],
    },
    handler: async () => ({
      success: true,
      output: 'compact_context is handled as a special case by the agent loop.',
    }),
  };
}
