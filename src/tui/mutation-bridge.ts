// pattern: Imperative Shell

/**
 * Mutation approval bridge that uses an event bus to prompt for user feedback.
 * Returns a callback compatible with processPendingMutations.
 */

import type { PendingMutation } from '@/memory/types.ts';
import type { AgentEventBus } from './types.ts';

export function createMutationPromptViaBus(
  bus: AgentEventBus,
): (mutation: PendingMutation) => Promise<string> {
  return async (mutation: PendingMutation): Promise<string> => {
    const mutationId = crypto.randomUUID();

    // Publish mutation:request event
    bus.publish({
      type: 'mutation:request',
      mutationId,
      blockId: mutation.block_id,
      proposedContent: mutation.proposed_content,
      reason: mutation.reason,
    });

    // Return a promise that resolves when a matching mutation:response arrives
    return new Promise<string>(resolve => {
      const unsubscribe = bus.subscribe(event => {
        if (
          event.type === 'mutation:response' &&
          event.mutationId === mutationId
        ) {
          // Unsubscribe immediately
          unsubscribe();

          // Resolve with appropriate response
          if (event.approved) {
            resolve('y');
          } else if (event.feedback) {
            // Prefix feedback to avoid collision with literal 'y' or 'n'
            resolve(`feedback: ${event.feedback}`);
          } else {
            resolve('n');
          }
        }
      });
    });
  };
}
