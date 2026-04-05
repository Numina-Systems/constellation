// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { render } from 'ink-testing-library';
import { MutationPrompt } from './mutation-prompt.tsx';
import { createAgentEventBus } from '../event-bus.ts';
import type { AgentEvent } from '../types.ts';

describe('MutationPrompt', () => {
  describe('tui.AC6.1: Display mutation request inline prompt', () => {
    it('renders block ID and proposed content when mutation:request arrives', async () => {
      const bus = createAgentEventBus();
      const { lastFrame, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      // Publish a mutation:request event
      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'Updated memory content here',
        reason: 'Agent suggests this change',
      });

      // Give time for event to process
      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      expect(output).toContain('block-123');
      expect(output).toContain('Updated memory content here');

      unmount();
    });

    it('shows reason when present', async () => {
      const bus = createAgentEventBus();
      const { lastFrame, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'New content',
        reason: 'Improve clarity',
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      expect(output).toContain('Improve clarity');

      unmount();
    });

    it('shows approval options', async () => {
      const bus = createAgentEventBus();
      const { lastFrame, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'New content',
        reason: null,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      const output = lastFrame();
      expect(output).toContain('y');
      expect(output).toContain('n');
      expect(output).toContain('f');

      unmount();
    });
  });

  describe('tui.AC6.2: User can approve, reject, or provide feedback', () => {
    it('publishes mutation:response with approved: true when y key pressed', async () => {
      const bus = createAgentEventBus();
      const publishedResponses: Array<AgentEvent> = [];

      bus.subscribe(event => {
        if (event.type === 'mutation:response') {
          publishedResponses.push(event);
        }
      });

      const { stdin, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'New content',
        reason: null,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate pressing 'y'
      stdin.write('y');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(publishedResponses).toHaveLength(1);
      const response = publishedResponses[0]!;
      if (response.type === 'mutation:response') {
        expect(response.mutationId).toBe('mut-1');
        expect(response.approved).toBe(true);
      }

      unmount();
    });

    it('publishes mutation:response with approved: false when n key pressed', async () => {
      const bus = createAgentEventBus();
      const publishedResponses: Array<AgentEvent> = [];

      bus.subscribe(event => {
        if (event.type === 'mutation:response') {
          publishedResponses.push(event);
        }
      });

      const { stdin, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'New content',
        reason: null,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate pressing 'n'
      stdin.write('n');

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(publishedResponses).toHaveLength(1);
      const response = publishedResponses[0]!;
      if (response.type === 'mutation:response') {
        expect(response.mutationId).toBe('mut-1');
        expect(response.approved).toBe(false);
      }

      unmount();
    });

    it('enters feedback mode and publishes response with feedback on f key + Enter', async () => {
      const bus = createAgentEventBus();
      const publishedResponses: Array<AgentEvent> = [];

      bus.subscribe(event => {
        if (event.type === 'mutation:response') {
          publishedResponses.push(event);
        }
      });

      const { stdin, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'New content',
        reason: null,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      // Simulate pressing 'f'
      stdin.write('f');

      await new Promise(resolve => setTimeout(resolve, 50));

      // Type feedback text
      stdin.write('t');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('o');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('o');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write(' ');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('b');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('r');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('i');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('e');
      await new Promise(resolve => setTimeout(resolve, 20));
      stdin.write('f');

      // Press Enter to submit
      await new Promise(resolve => setTimeout(resolve, 50));
      stdin.write('\r');

      await new Promise(resolve => setTimeout(resolve, 200));

      expect(publishedResponses).toHaveLength(1);
      const response = publishedResponses[0]!;
      if (response.type === 'mutation:response') {
        expect(response.mutationId).toBe('mut-1');
        expect(response.approved).toBe(false);
        expect(response.feedback).toBe('too brief');
      }

      unmount();
    });

    it('clears request after publishing response', async () => {
      const bus = createAgentEventBus();
      const { lastFrame, stdin, unmount } = render(
        <MutationPrompt bus={bus} />
      );

      bus.publish({
        type: 'mutation:request',
        mutationId: 'mut-1',
        blockId: 'block-123',
        proposedContent: 'Content 1',
        reason: null,
      });

      await new Promise(resolve => setTimeout(resolve, 50));

      let output = lastFrame();
      expect(output).toContain('Content 1');

      // Approve the mutation
      stdin.write('y');

      await new Promise(resolve => setTimeout(resolve, 100));

      // After clearing, the content should no longer be visible
      output = lastFrame();
      expect(output).not.toContain('Content 1');

      unmount();
    });
  });
});
