import {describe, test, expect} from 'bun:test';
import {buildUserMessage} from './messages.ts';
import type {SnapshotResult} from './snapshot.ts';
import type {TextBlock} from '../model/types.ts';

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
