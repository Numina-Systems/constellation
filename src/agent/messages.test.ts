import {describe, test, expect} from 'bun:test';
import {buildUserMessage} from './messages.ts';
import {buildMessages} from './context.ts';
import type {SnapshotResult} from './snapshot.ts';
import type {TextBlock} from '../model/types.ts';
import type {ConversationMessage} from './types.ts';

// Type guard to narrow ContentBlock to TextBlock
function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as Record<string, unknown>)['type'] === 'text'
  );
}

describe('AC2: Attachment Composition', () => {
  test('AC2.1 — full snapshot produces single attachment block', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context\n\n## Memory\nSome memory',
      hashes: new Map([
        ['recall', 123n],
        ['memory', 456n],
      ]),
      changedProviders: ['recall', 'memory'],
    };

    const result = buildUserMessage('hello', fullSnapshot);

    expect(result.role).toBe('user');
    expect(Array.isArray(result.content)).toBe(true);
    if (!Array.isArray(result.content)) throw new Error('Expected array');
    const contentArray = result.content;
    expect(contentArray.length).toBe(2);
    expect(isTextBlock(contentArray[0])).toBe(true);
    expect(isTextBlock(contentArray[1])).toBe(true);
  });

  test('AC2.2 — attachment block is prepended', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', fullSnapshot);
    if (!Array.isArray(result.content)) throw new Error('Expected array');
    const contentArray = result.content;

    expect(isTextBlock(contentArray[0])).toBe(true);
    if (!isTextBlock(contentArray[0])) throw new Error('Expected TextBlock');
    expect(contentArray[0].text).toMatch(/^\[Dynamic Context/);
  });

  test('AC2.3 — user text is last content block', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', fullSnapshot);
    if (!Array.isArray(result.content)) throw new Error('Expected array');
    const contentArray = result.content;

    expect(isTextBlock(contentArray[1])).toBe(true);
    if (!isTextBlock(contentArray[1])) throw new Error('Expected TextBlock');
    expect(contentArray[1].text).toBe('hello');
  });

  test('AC2.4 — noop snapshot produces no attachment', async () => {
    const noopSnapshot: SnapshotResult = {
      mode: 'noop',
      content: null,
      hashes: new Map(),
      changedProviders: [],
    };

    const result = buildUserMessage('hello', noopSnapshot);

    expect(result.role).toBe('user');
    expect(result.content).toBe('hello');
    expect(typeof result.content).toBe('string');
  });

  test('AC2.4 (variant) — null snapshot produces no attachment', async () => {
    const result = buildUserMessage('hello', null);

    expect(result.role).toBe('user');
    expect(result.content).toBe('hello');
    expect(typeof result.content).toBe('string');
  });

  test('AC2.4 (variant) — full snapshot with null content produces no attachment', async () => {
    const fullSnapshotNullContent: SnapshotResult = {
      mode: 'full',
      content: null,
      hashes: new Map(),
      changedProviders: [],
    };

    const result = buildUserMessage('hello', fullSnapshotNullContent);

    expect(result.role).toBe('user');
    expect(result.content).toBe('hello');
    expect(typeof result.content).toBe('string');
  });

  test('AC2.5 — attachment content never in system prompt (message role is user)', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', fullSnapshot);

    expect(result.role).toBe('user');
  });

  test('Delta snapshot includes only changed sections', async () => {
    const deltaSnapshot: SnapshotResult = {
      mode: 'delta',
      content: '## Recall\nUpdated recall context',
      hashes: new Map([['recall', 789n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', deltaSnapshot);
    if (!Array.isArray(result.content)) throw new Error('Expected array');
    const contentArray = result.content;

    expect(isTextBlock(contentArray[0])).toBe(true);
    if (!isTextBlock(contentArray[0])) throw new Error('Expected TextBlock');
    expect(contentArray[0].text).toMatch(/\[Dynamic Context — Updated Sections\]/);
    expect(contentArray[0].text).toContain('## Recall\nUpdated recall context');
  });

  test('Attachment header distinguishes full from delta', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nContent',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const resultFull = buildUserMessage('hello', fullSnapshot);
    if (!Array.isArray(resultFull.content)) throw new Error('Expected array');
    const contentArrayFull = resultFull.content;
    expect(isTextBlock(contentArrayFull[0])).toBe(true);
    if (!isTextBlock(contentArrayFull[0])) throw new Error('Expected TextBlock');
    expect(contentArrayFull[0].text).toContain('Full Snapshot');

    const deltaSnapshot: SnapshotResult = {
      mode: 'delta',
      content: '## Recall\nContent',
      hashes: new Map([['recall', 456n]]),
      changedProviders: ['recall'],
    };

    const resultDelta = buildUserMessage('hello', deltaSnapshot);
    if (!Array.isArray(resultDelta.content)) throw new Error('Expected array');
    const contentArrayDelta = resultDelta.content;
    expect(isTextBlock(contentArrayDelta[0])).toBe(true);
    if (!isTextBlock(contentArrayDelta[0])) throw new Error('Expected TextBlock');
    expect(contentArrayDelta[0].text).toContain('Updated Sections');
  });
});

describe('AC6.1: End-to-End Message Composition', () => {
  test('AC6.1: buildMessages() composes conversation history without working memory prepend', async () => {
    // Working memory is now delivered via the snapshot pipeline, not prepended to history
    const history: ConversationMessage[] = [
      {
        id: '1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'hello',
        created_at: new Date(),
      },
      {
        id: '2',
        conversation_id: 'conv-1',
        role: 'assistant',
        content: 'hi there',
        created_at: new Date(),
      },
    ];

    const messages = await buildMessages(history);

    // buildMessages now outputs only the history messages, no prepended working memory
    expect(messages.length).toBe(2);
    expect(messages[0]).toBeDefined();
    expect(messages[0]!.role).toBe('user');
    expect(messages[0]!.content).toBe('hello');

    // Second message should be the assistant response
    expect(messages[1]).toBeDefined();
    expect(messages[1]!.role).toBe('assistant');
    expect(messages[1]!.content).toBe('hi there');
  });

  test('AC6.1: buildUserMessage() attaches dynamic context to the current turn', async () => {
    const snapshotWithRecall: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nRecalled past context about the topic.',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('what did we discuss?', snapshotWithRecall);

    expect(Array.isArray(result.content)).toBe(true);
    if (!Array.isArray(result.content)) throw new Error('Expected array');

    // First block is the attachment
    const attachmentBlock = result.content[0];
    expect(isTextBlock(attachmentBlock)).toBe(true);
    if (!isTextBlock(attachmentBlock)) throw new Error('Expected TextBlock');
    expect(attachmentBlock.text).toContain('[Dynamic Context — Full Snapshot]');
    expect(attachmentBlock.text).toContain('Recalled past context');

    // Second block is the user message
    const userBlock = result.content[1];
    expect(isTextBlock(userBlock)).toBe(true);
    if (!isTextBlock(userBlock)) throw new Error('Expected TextBlock');
    expect(userBlock.text).toBe('what did we discuss?');
  });

  test('AC6.1: End-to-end composition — buildMessages history + buildUserMessage current turn', async () => {
    // Working memory is now delivered via the snapshot pipeline, not prepended
    const history: ConversationMessage[] = [
      {
        id: '1',
        conversation_id: 'conv-1',
        role: 'user',
        content: 'first message',
        created_at: new Date(),
      },
    ];

    const messages = await buildMessages(history);

    // Add the current turn with dynamic context
    const currentTurnSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nRecall for current turn.',
      hashes: new Map([['recall', 456n]]),
      changedProviders: ['recall'],
    };

    const currentUserMessage = buildUserMessage('follow-up message', currentTurnSnapshot);

    // Compose final message array
    const finalMessages = [...messages, currentUserMessage];

    // Verify overall structure: [previous-user, current-user-with-attachment]
    // (working memory is now in the snapshot for the current user message)
    expect(finalMessages.length).toBe(2);

    // Index 0: Previous user message
    expect(finalMessages[0]).toBeDefined();
    expect(finalMessages[0]!.role).toBe('user');
    expect(finalMessages[0]!.content).toBe('first message');

    // Index 1: Current user message with attachment
    expect(finalMessages[1]).toBeDefined();
    expect(finalMessages[1]!.role).toBe('user');
    expect(Array.isArray(finalMessages[1]!.content)).toBe(true);
    if (!Array.isArray(finalMessages[1]!.content)) throw new Error('Expected array');

    const currentContent = finalMessages[1]!.content;
    expect(currentContent.length).toBe(2);

    // Attachment block (contains dynamic context from snapshot)
    expect(currentContent[0]).toBeDefined();
    expect(isTextBlock(currentContent[0]!)).toBe(true);
    if (!isTextBlock(currentContent[0]!)) throw new Error('Expected TextBlock');
    expect(currentContent[0]!.text).toContain('[Dynamic Context — Full Snapshot]');

    // User message block
    expect(currentContent[1]).toBeDefined();
    expect(isTextBlock(currentContent[1]!)).toBe(true);
    if (!isTextBlock(currentContent[1]!)) throw new Error('Expected TextBlock');
    expect(currentContent[1]!.text).toBe('follow-up message');
  });
});
