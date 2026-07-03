// pattern: Functional Core

/**
 * Unit tests for working-memory context provider.
 * Verifies the formatter contract and provider state behavior.
 */

import { describe, it, expect } from 'bun:test';
import {
  formatWorkingMemorySection,
  createWorkingMemoryContextProvider,
} from './context.ts';
import type { MemoryBlock } from './types.ts';

function createTestBlock(overrides?: Partial<MemoryBlock>): MemoryBlock {
  return {
    id: 'test-id',
    owner: 'test-owner',
    tier: 'working',
    label: 'test-label',
    content: 'test content',
    embedding: null,
    permission: 'readwrite',
    pinned: false,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('formatWorkingMemorySection', () => {
  it('returns undefined for empty blocks', () => {
    const result = formatWorkingMemorySection([]);
    expect(result).toBeUndefined();
  });

  it('formats single block as heading and content', () => {
    const block = createTestBlock({
      label: 'context',
      content: 'some content',
    });

    const result = formatWorkingMemorySection([block]);

    expect(result).toBe('### context\nsome content');
  });

  it('formats two blocks with heading separation', () => {
    const block1 = createTestBlock({
      label: 'label1',
      content: 'content1',
    });
    const block2 = createTestBlock({
      label: 'label2',
      content: 'content2',
    });

    const result = formatWorkingMemorySection([block1, block2]);

    expect(result).toBe(
      '### label1\ncontent1\n\n### label2\ncontent2'
    );
  });

  it('cache-friendliness.AC3.3 (unit): empty blocks return undefined', () => {
    // Explicit AC label test as requested in phase file
    const result = formatWorkingMemorySection([]);
    expect(result).toBeUndefined();
  });
});

describe('createWorkingMemoryContextProvider', () => {
  it('returns undefined before setBlocks is called', () => {
    const provider = createWorkingMemoryContextProvider();
    const result = provider();
    expect(result).toBeUndefined();
  });

  it('returns undefined after setBlocks is called with empty array', () => {
    const provider = createWorkingMemoryContextProvider();
    provider.setBlocks([]);
    const result = provider();
    expect(result).toBeUndefined();
  });

  it('returns formatted section after setBlocks is called with blocks', () => {
    const provider = createWorkingMemoryContextProvider();
    const block = createTestBlock({
      label: 'context',
      content: 'some content',
    });

    provider.setBlocks([block]);
    const result = provider();

    expect(result).toBe('### context\nsome content');
  });

  it('updates when setBlocks is called multiple times', () => {
    const provider = createWorkingMemoryContextProvider();

    const block1 = createTestBlock({
      label: 'label1',
      content: 'content1',
    });
    provider.setBlocks([block1]);
    expect(provider()).toBe('### label1\ncontent1');

    const block2 = createTestBlock({
      label: 'label2',
      content: 'content2',
    });
    provider.setBlocks([block2]);
    expect(provider()).toBe('### label2\ncontent2');
  });

  it('returns undefined when reset with empty array', () => {
    const provider = createWorkingMemoryContextProvider();
    const block = createTestBlock();

    provider.setBlocks([block]);
    expect(provider()).toBeDefined();

    provider.setBlocks([]);
    expect(provider()).toBeUndefined();
  });
});
