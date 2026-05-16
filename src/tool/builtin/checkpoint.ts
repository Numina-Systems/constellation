// pattern: Imperative Shell

/**
 * Checkpoint tool definition.
 * Provides a user-callable `/checkpoint` command to create a snapshot of agent state.
 */

import type { Tool } from '../types.ts';
import type { CheckpointDependencies, CheckpointAgentState } from '@/agent/checkpoint-create.ts';
import { performCheckpoint } from '@/agent/checkpoint-create.ts';

export function createCheckpointTool(
  deps: CheckpointDependencies,
  getAgentState: () => CheckpointAgentState,
): Tool {
  return {
    definition: {
      name: 'checkpoint',
      description:
        'Create a snapshot of the current agent state including conversation history, working memory, predictions, interests, and compaction metadata. Returns the checkpoint ID.',
      parameters: [],
    },
    handler: async () => {
      const id = await performCheckpoint('explicit', getAgentState(), deps);

      if (id === null) {
        return {
          success: false,
          output: 'Checkpoint creation failed. Check logs for details.',
          error: 'checkpoint_failed',
        };
      }

      return {
        success: true,
        output: `Checkpoint created: ${id}`,
      };
    },
  };
}
