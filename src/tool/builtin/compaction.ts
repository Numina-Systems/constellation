// pattern: Functional Core

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
      success: false,
      output: '',
      error: 'compact_context is dispatched by the agent loop, not the tool registry',
    }),
  };
}
