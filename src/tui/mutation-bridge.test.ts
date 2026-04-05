import { describe, it, expect } from 'bun:test';
import { createAgentEventBus } from './event-bus.ts';
import { createMutationPromptViaBus } from './mutation-bridge.ts';
import type { PendingMutation } from '@/memory/types.ts';
import type { AgentEvent } from './types.ts';

function createTestMutation(overrides?: Partial<PendingMutation>): PendingMutation {
  const base: PendingMutation = {
    id: 'mut-1',
    block_id: 'block-123',
    proposed_content: 'Updated content',
    reason: 'Agent suggests improvement',
    status: 'pending',
    feedback: null,
    created_at: new Date(),
    resolved_at: null,
  };
  return { ...base, ...overrides };
}

describe('createMutationPromptViaBus', () => {
  describe('tui.AC6.3: Mutation approval via event bus', () => {
    it('publishes mutation:request and resolves with "y" on approval', async () => {
      const bus = createAgentEventBus();
      const callback = createMutationPromptViaBus(bus);

      const mutation = createTestMutation();

      // Subscribe to capture published events
      const publishedEvents: Array<Extract<AgentEvent, { type: 'mutation:request' } | { type: 'mutation:response' }>> = [];
      bus.subscribe(event => {
        if (event.type === 'mutation:request' || event.type === 'mutation:response') {
          publishedEvents.push(event as Extract<AgentEvent, { type: 'mutation:request' } | { type: 'mutation:response' }>);
        }
      });

      // Start the callback (returns a promise)
      const callbackPromise = callback(mutation);

      // Give event bus time to publish
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify mutation:request was published
      expect(publishedEvents).toHaveLength(1);
      const request = publishedEvents[0];
      expect(request).toBeDefined();
      expect(request!.type).toBe('mutation:request');
      if (request && request.type === 'mutation:request') {
        expect(request.mutationId).toBeDefined();
        expect(request.blockId).toBe('block-123');
        expect(request.proposedContent).toBe('Updated content');
        expect(request.reason).toBe('Agent suggests improvement');
      }

      // Capture the mutationId for the response
      const mutationId = request && request.type === 'mutation:request' ? request.mutationId : undefined;

      // Now publish a mutation:response with approval
      bus.publish({
        type: 'mutation:response',
        mutationId: mutationId!,
        approved: true,
      });

      // Wait for the callback promise to resolve
      const result = await callbackPromise;

      // Verify the callback resolved with 'y'
      expect(result).toBe('y');
    });

    it('resolves with "n" on rejection without feedback', async () => {
      const bus = createAgentEventBus();
      const callback = createMutationPromptViaBus(bus);

      const mutation = createTestMutation();

      // Capture published events
      let capturedMutationId: string | undefined;
      bus.subscribe(event => {
        if (event.type === 'mutation:request') {
          capturedMutationId = event.mutationId;
        }
      });

      const callbackPromise = callback(mutation);

      // Give event bus time to publish
      await new Promise(resolve => setTimeout(resolve, 10));

      // Publish rejection response
      expect(capturedMutationId).toBeDefined();
      bus.publish({
        type: 'mutation:response',
        mutationId: capturedMutationId!,
        approved: false,
      });

      const result = await callbackPromise;

      // Verify the callback resolved with 'n'
      expect(result).toBe('n');
    });

    it('resolves with prefixed feedback on rejection with feedback', async () => {
      const bus = createAgentEventBus();
      const callback = createMutationPromptViaBus(bus);

      const mutation = createTestMutation();

      // Capture published events
      let capturedMutationId: string | undefined;
      bus.subscribe(event => {
        if (event.type === 'mutation:request') {
          capturedMutationId = event.mutationId;
        }
      });

      const callbackPromise = callback(mutation);

      // Give event bus time to publish
      await new Promise(resolve => setTimeout(resolve, 10));

      // Publish rejection response with feedback
      expect(capturedMutationId).toBeDefined();
      bus.publish({
        type: 'mutation:response',
        mutationId: capturedMutationId!,
        approved: false,
        feedback: 'needs work',
      });

      const result = await callbackPromise;

      // Verify the callback resolved with prefixed feedback
      expect(result).toBe('feedback: needs work');
    });

    it('handles null reason in mutation', async () => {
      const bus = createAgentEventBus();
      const callback = createMutationPromptViaBus(bus);

      const mutation = createTestMutation({ reason: null });

      // Capture published events
      const publishedEvents: Array<Extract<AgentEvent, { type: 'mutation:request' }>> = [];
      bus.subscribe(event => {
        if (event.type === 'mutation:request') {
          publishedEvents.push(event);
        }
      });

      const callbackPromise = callback(mutation);

      // Give event bus time to publish
      await new Promise(resolve => setTimeout(resolve, 10));

      const request = publishedEvents[0];
      expect(request).toBeDefined();
      expect(request!.reason).toBeNull();

      // Publish approval
      bus.publish({
        type: 'mutation:response',
        mutationId: request!.mutationId,
        approved: true,
      });

      const result = await callbackPromise;
      expect(result).toBe('y');
    });
  });
});
