import { describe, expect, test } from 'bun:test';
import { ConstellationError } from './base.js';
import { MemoryError } from './memory.js';

describe('MemoryError', () => {
  // AC2.1: Each MemoryErrorCode constructs a valid MemoryError
  test('constructs BLOCK_NOT_FOUND error', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error).toBeDefined();
    expect(error.code).toBe('BLOCK_NOT_FOUND');
  });

  test('constructs PERMISSION_DENIED error', () => {
    const error = new MemoryError('PERMISSION_DENIED', 'Permission denied');
    expect(error).toBeDefined();
    expect(error.code).toBe('PERMISSION_DENIED');
  });

  test('constructs MUTATION_REJECTED error', () => {
    const error = new MemoryError('MUTATION_REJECTED', 'Mutation rejected');
    expect(error).toBeDefined();
    expect(error.code).toBe('MUTATION_REJECTED');
  });

  test('constructs MUTATION_NOT_FOUND error', () => {
    const error = new MemoryError('MUTATION_NOT_FOUND', 'Mutation not found');
    expect(error).toBeDefined();
    expect(error.code).toBe('MUTATION_NOT_FOUND');
  });

  test('constructs EMBEDDING_FAILED error', () => {
    const error = new MemoryError('EMBEDDING_FAILED', 'Embedding failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('EMBEDDING_FAILED');
  });

  // AC2.2: BLOCK_NOT_FOUND with available labels in context
  test('BLOCK_NOT_FOUND includes available labels in context', () => {
    const error = new MemoryError(
      'BLOCK_NOT_FOUND',
      'Block not found',
      { available: ['status', 'goals', 'personality'] }
    );
    expect(error.context).toBeDefined();
    expect(error.context.available).toEqual(['status', 'goals', 'personality']);
  });

  // AC6.4: MemoryError instanceof checks
  test('MemoryError is instanceof MemoryError', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error instanceof MemoryError).toBe(true);
  });

  test('MemoryError is instanceof ConstellationError', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error instanceof ConstellationError).toBe(true);
  });

  test('MemoryError is instanceof Error', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error instanceof Error).toBe(true);
  });

  test('toDisplayString formats correctly', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error.toDisplayString()).toBe('[memory:BLOCK_NOT_FOUND] Block not found');
  });

  test('toDisplayString includes suggestion when provided', () => {
    const error = new MemoryError(
      'BLOCK_NOT_FOUND',
      'Block not found',
      {},
      { suggestion: 'Verify the block ID exists' }
    );
    expect(error.toDisplayString()).toBe(
      '[memory:BLOCK_NOT_FOUND] Block not found — Suggestion: Verify the block ID exists'
    );
  });

  test('default context is empty object when not provided', () => {
    const error = new MemoryError('BLOCK_NOT_FOUND', 'Block not found');
    expect(error.context).toEqual({});
  });
});
