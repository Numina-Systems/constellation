import {describe, test, expect} from 'bun:test';
import {buildUserMessage} from './messages.ts';
import {buildMessages} from './context.ts';
import type {SnapshotResult} from './snapshot.ts';
import type {ConversationMessage} from './types.ts';

describe('AC2: Attachment Composition', () => {
  test('AC2.1 — full snapshot produces single-string message', async () => {
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
    expect(typeof result.content).toBe('string');
    if (typeof result.content !== 'string') throw new Error('Expected string');
    expect(result.content).toContain('[Dynamic Context — Full Snapshot]');
    expect(result.content).toContain('## Recall');
    expect(result.content).toContain('hello');
  });

  test('AC2.2 — attachment is prepended in single string', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', fullSnapshot);
    if (typeof result.content !== 'string') throw new Error('Expected string');

    expect(result.content).toMatch(/^\[Dynamic Context/);
    const parts = result.content.split('\n\n');
    expect(parts[0]).toContain('[Dynamic Context');
    expect(parts[parts.length - 1]).toBe('hello');
  });

  test('AC2.3 — user text is last in single string', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nSome recalled context',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', fullSnapshot);
    if (typeof result.content !== 'string') throw new Error('Expected string');

    expect(result.content.endsWith('hello')).toBe(true);
  });

  test('cache-friendliness.AC4.3: composed messages are single strings', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Section\nSome content',
      hashes: new Map([['section', 123n]]),
      changedProviders: ['section'],
    };

    const result = buildUserMessage('user text', fullSnapshot);

    expect(result.role).toBe('user');
    expect(typeof result.content).toBe('string');
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

  test('Delta snapshot includes only changed sections as single string', async () => {
    const deltaSnapshot: SnapshotResult = {
      mode: 'delta',
      content: '## Recall\nUpdated recall context',
      hashes: new Map([['recall', 789n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('hello', deltaSnapshot);
    if (typeof result.content !== 'string') throw new Error('Expected string');

    expect(result.content).toMatch(/\[Dynamic Context — Updated Sections\]/);
    expect(result.content).toContain('## Recall\nUpdated recall context');
    expect(result.content).toContain('hello');
  });

  test('Attachment header distinguishes full from delta in single string', async () => {
    const fullSnapshot: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nContent',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const resultFull = buildUserMessage('hello', fullSnapshot);
    if (typeof resultFull.content !== 'string') throw new Error('Expected string');
    expect(resultFull.content).toContain('Full Snapshot');

    const deltaSnapshot: SnapshotResult = {
      mode: 'delta',
      content: '## Recall\nContent',
      hashes: new Map([['recall', 456n]]),
      changedProviders: ['recall'],
    };

    const resultDelta = buildUserMessage('hello', deltaSnapshot);
    if (typeof resultDelta.content !== 'string') throw new Error('Expected string');
    expect(resultDelta.content).toContain('Updated Sections');
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

  test('AC6.1: buildUserMessage() attaches dynamic context as single string', async () => {
    const snapshotWithRecall: SnapshotResult = {
      mode: 'full',
      content: '## Recall\nRecalled past context about the topic.',
      hashes: new Map([['recall', 123n]]),
      changedProviders: ['recall'],
    };

    const result = buildUserMessage('what did we discuss?', snapshotWithRecall);

    expect(typeof result.content).toBe('string');
    if (typeof result.content !== 'string') throw new Error('Expected string');

    expect(result.content).toContain('[Dynamic Context — Full Snapshot]');
    expect(result.content).toContain('Recalled past context');
    expect(result.content).toContain('what did we discuss?');
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

    // Index 1: Current user message with attachment as single string
    expect(finalMessages[1]).toBeDefined();
    expect(finalMessages[1]!.role).toBe('user');
    expect(typeof finalMessages[1]!.content).toBe('string');
    if (typeof finalMessages[1]!.content !== 'string') throw new Error('Expected string');

    const currentContent = finalMessages[1]!.content;
    expect(currentContent).toContain('[Dynamic Context — Full Snapshot]');
    expect(currentContent).toContain('Recall for current turn');
    expect(currentContent).toContain('follow-up message');
  });
});
