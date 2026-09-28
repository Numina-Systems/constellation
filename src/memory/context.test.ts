// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { formatWorkingMemorySection, createWorkingMemoryContextProvider } from './context.ts';
import type { MemoryBlock } from './types.ts';

describe('formatWorkingMemorySection', () => {
  test('cache-friendliness.AC3.3: empty blocks returns undefined', () => {
    const result = formatWorkingMemorySection([]);
    expect(result).toBeUndefined();
  });

  test('single block formats correctly', () => {
    const blocks: Array<MemoryBlock> = [
      {
        id: 'b1',
        owner: 'test',
        tier: 'working',
        label: 'Current Focus',
        content: 'Working on feature X',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const result = formatWorkingMemorySection(blocks);
    expect(result).toBe('### Current Focus\nWorking on feature X');
  });

  test('two blocks format with separator', () => {
    const blocks: Array<MemoryBlock> = [
      {
        id: 'b1',
        owner: 'test',
        tier: 'working',
        label: 'Context A',
        content: 'Content for A',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        id: 'b2',
        owner: 'test',
        tier: 'working',
        label: 'Context B',
        content: 'Content for B',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    const result = formatWorkingMemorySection(blocks);
    expect(result).toBe('### Context A\nContent for A\n\n### Context B\nContent for B');
  });
});

describe('createWorkingMemoryContextProvider', () => {
  test('returns undefined before setBlocks is called', () => {
    const provider = createWorkingMemoryContextProvider();
    const result = provider();
    expect(result).toBeUndefined();
  });

  test('returns undefined after setBlocks([])', () => {
    const provider = createWorkingMemoryContextProvider();
    provider.setBlocks([]);
    const result = provider();
    expect(result).toBeUndefined();
  });

  test('returns formatted section after setBlocks with blocks', () => {
    const provider = createWorkingMemoryContextProvider();
    const blocks: Array<MemoryBlock> = [
      {
        id: 'b1',
        owner: 'test',
        tier: 'working',
        label: 'Session State',
        content: 'Active',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    provider.setBlocks(blocks);
    const result = provider();

    expect(result).toBe('### Session State\nActive');
  });

  test('updates content when setBlocks is called multiple times', () => {
    const provider = createWorkingMemoryContextProvider();

    const block1: Array<MemoryBlock> = [
      {
        id: 'b1',
        owner: 'test',
        tier: 'working',
        label: 'V1',
        content: 'Version 1',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    provider.setBlocks(block1);
    const result1 = provider();
    expect(result1).toContain('Version 1');

    const block2: Array<MemoryBlock> = [
      {
        id: 'b1',
        owner: 'test',
        tier: 'working',
        label: 'V2',
        content: 'Version 2',
        embedding: null,
        permission: 'readwrite',
        pinned: false,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];

    provider.setBlocks(block2);
    const result2 = provider();
    expect(result2).toContain('Version 2');
    expect(result2).not.toContain('Version 1');
  });
});
