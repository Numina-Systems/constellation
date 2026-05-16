// pattern: Functional Core

/**
 * Backward compatibility tests for batch-anchored snapshots.
 *
 * Verifies:
 * - AC5.1: Messages with content arrays (attachments) load correctly
 * - AC5.2: Old messages without attachments still work
 * - AC5.3: ContextProvider interface unchanged
 * - AC5.4: Compaction compatibility with attachment blocks
 */

import { describe, test, expect } from 'bun:test';
import { buildUserMessage } from './messages';
import { createSnapshotState, hashProviderOutput } from './snapshot';
import type { ConversationMessage, ContextProvider } from './types';
import type { TextBlock } from '../model/types';
import { estimateTokens, shouldCompress } from './context';

describe('AC5: Backward Compatibility', () => {
  describe('AC5.1: Messages with content arrays load correctly', () => {
    test('buildUserMessage composes user message with snapshot attachment', () => {
      const userText = 'Hello, how are you?';
      const snapshotResult = {
        mode: 'full' as const,
        content: '## Recall\n\nSome context from memory',
        hashes: new Map([['recall', BigInt(123456)]]),
        changedProviders: ['recall'],
      };

      const message = buildUserMessage(userText, snapshotResult);

      expect(message.role).toBe('user');
      expect(Array.isArray(message.content)).toBe(true);
      if (Array.isArray(message.content)) {
        expect(message.content.length).toBe(2);
        const attachmentBlock = message.content[0] as TextBlock;
        const userBlock = message.content[1] as TextBlock;
        expect(attachmentBlock?.type).toBe('text');
        expect(userBlock?.type).toBe('text');
        expect(attachmentBlock?.text).toContain('Dynamic Context — Full Snapshot');
        expect(userBlock?.text).toBe(userText);
      }
    });

    test('buildUserMessage with delta snapshot shows updated sections header', () => {
      const userText = 'Next question';
      const snapshotResult = {
        mode: 'delta' as const,
        content: '## Scheduling\n\nUpdated schedule info',
        hashes: new Map([['scheduling', BigInt(789)]]),
        changedProviders: ['scheduling'],
      };

      const message = buildUserMessage(userText, snapshotResult);

      expect(Array.isArray(message.content)).toBe(true);
      if (Array.isArray(message.content)) {
        const attachmentBlock = message.content[0] as TextBlock;
        expect(attachmentBlock.text).toContain('Dynamic Context — Updated Sections');
      }
    });
  });

  describe('AC5.2: Old messages without attachments still work', () => {
    test('buildUserMessage without snapshot returns plain string message', () => {
      const userText = 'This is a regular message';
      const message = buildUserMessage(userText, null);

      expect(message.role).toBe('user');
      expect(typeof message.content).toBe('string');
      expect(message.content).toBe(userText);
    });

    test('buildUserMessage with noop snapshot returns plain string message', () => {
      const userText = 'No changes this round';
      const snapshotResult = {
        mode: 'noop' as const,
        content: null,
        hashes: new Map(),
        changedProviders: [],
      };

      const message = buildUserMessage(userText, snapshotResult);

      expect(typeof message.content).toBe('string');
      expect(message.content).toBe(userText);
    });

    test('buildUserMessage with full snapshot but null content returns plain string', () => {
      const userText = 'No providers';
      const snapshotResult = {
        mode: 'full' as const,
        content: null,
        hashes: new Map(),
        changedProviders: [],
      };

      const message = buildUserMessage(userText, snapshotResult);

      expect(typeof message.content).toBe('string');
      expect(message.content).toBe(userText);
    });
  });

  describe('AC5.3: ContextProvider interface unchanged', () => {
    test('ContextProvider accepts function with string return', () => {
      const provider: ContextProvider = () => 'some context';
      expect(provider()).toBe('some context');
    });

    test('ContextProvider accepts function with undefined return', () => {
      const undefinedProvider: ContextProvider = () => undefined;
      expect(undefinedProvider()).toBeUndefined();
    });

    test('ContextProvider interface maintains backward compatibility', () => {
      const providers: Array<ContextProvider> = [
        () => 'context1',
        () => undefined,
        () => 'context2',
      ];

      const results = providers.map(p => p());
      expect(results).toEqual(['context1', undefined, 'context2']);
    });
  });

  describe('AC5.4: Compaction compatibility with attachment blocks', () => {
    test('estimateTokens handles message content with attachment text', () => {
      const contentWithAttachment = '[Dynamic Context — Full Snapshot]\n\n## Recall\nSome context\n\nHello, how are you?';
      const tokens = estimateTokens(contentWithAttachment);
      expect(tokens).toBeGreaterThan(0);
    });

    test('shouldCompress works with messages containing attachments', () => {
      const messageWithAttachment: ConversationMessage = {
        id: 'test-1',
        conversation_id: 'conv-1',
        role: 'user',
        content: '[Dynamic Context — Full Snapshot]\n\n## Recall\nSome context\n\nHello, how are you?',
        created_at: new Date(),
      };

      const result = shouldCompress([messageWithAttachment], 0.5, 100000, 1000);
      expect(typeof result).toBe('boolean');
    });

    test('shouldCompress handles multiple messages with attachments', () => {
      const messages: Array<ConversationMessage> = [
        {
          id: '1',
          conversation_id: 'conv-1',
          role: 'user',
          content: '[Dynamic Context — Full Snapshot]\n\n## Recall\nContext 1\n\nFirst message',
          created_at: new Date(Date.now() - 10000),
        },
        {
          id: '2',
          conversation_id: 'conv-1',
          role: 'assistant',
          content: 'Assistant response',
          created_at: new Date(Date.now() - 5000),
        },
        {
          id: '3',
          conversation_id: 'conv-1',
          role: 'user',
          content: '[Dynamic Context — Updated Sections]\n\n## Activity\nUpdated activity\n\nSecond message',
          created_at: new Date(),
        },
      ];

      const result = shouldCompress(messages, 0.5, 100000, 1000);
      expect(typeof result).toBe('boolean');
    });

    test('snapshot state resets after compaction', () => {
      const snapshotState = createSnapshotState();
      const providers = new Map<string, () => string | undefined>([
        ['recall', () => 'context1'],
        ['activity', () => 'activity1'],
      ]);

      // First call: full snapshot
      let result = snapshotState.computeSnapshot(providers, false);
      expect(result.mode).toBe('full');
      expect(result.content).toBeDefined();

      // Reset (simulating compaction)
      snapshotState.reset();

      // Next call: full snapshot again (forced after reset)
      result = snapshotState.computeSnapshot(providers, false);
      expect(result.mode).toBe('full');
      expect(result.content).toBeDefined();
    });
  });

  describe('AC5: Hash stability', () => {
    test('hashProviderOutput is deterministic for same input', () => {
      const content = 'stable content';
      const hash1 = hashProviderOutput(content);
      const hash2 = hashProviderOutput(content);
      expect(hash1).toBe(hash2);
    });

    test('hashProviderOutput distinguishes between undefined and empty string', () => {
      const undefinedHash = hashProviderOutput(undefined);
      const emptyHash = hashProviderOutput('');
      expect(undefinedHash).not.toBe(emptyHash);
    });

    test('hashProviderOutput produces different hashes for different content', () => {
      const hash1 = hashProviderOutput('content1');
      const hash2 = hashProviderOutput('content2');
      expect(hash1).not.toBe(hash2);
    });
  });
});
