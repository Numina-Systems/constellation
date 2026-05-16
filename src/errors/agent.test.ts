import { describe, expect, test } from 'bun:test';
import { ConstellationError } from './base.js';
import { AgentError } from './agent.js';

describe('AgentError', () => {
  // AC2.7: Each AgentErrorCode constructs a valid AgentError
  test('constructs TOOL_DISPATCH_FAILED error', () => {
    const error = new AgentError('TOOL_DISPATCH_FAILED', 'Tool dispatch failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('TOOL_DISPATCH_FAILED');
  });

  test('constructs COMPACTION_FAILED error', () => {
    const error = new AgentError('COMPACTION_FAILED', 'Compaction failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('COMPACTION_FAILED');
  });

  test('constructs RECALL_FAILED error', () => {
    const error = new AgentError('RECALL_FAILED', 'Recall failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('RECALL_FAILED');
  });

  test('constructs CHECKPOINT_FAILED error', () => {
    const error = new AgentError('CHECKPOINT_FAILED', 'Checkpoint failed');
    expect(error).toBeDefined();
    expect(error.code).toBe('CHECKPOINT_FAILED');
  });

  // Instanceof checks
  test('AgentError is instanceof AgentError', () => {
    const error = new AgentError('TOOL_DISPATCH_FAILED', 'Tool dispatch failed');
    expect(error instanceof AgentError).toBe(true);
  });

  test('AgentError is instanceof ConstellationError', () => {
    const error = new AgentError('TOOL_DISPATCH_FAILED', 'Tool dispatch failed');
    expect(error instanceof ConstellationError).toBe(true);
  });

  test('AgentError is instanceof Error', () => {
    const error = new AgentError('TOOL_DISPATCH_FAILED', 'Tool dispatch failed');
    expect(error instanceof Error).toBe(true);
  });

  test('toDisplayString formats correctly', () => {
    const error = new AgentError('TOOL_DISPATCH_FAILED', 'Tool not found');
    expect(error.toDisplayString()).toBe('[agent:TOOL_DISPATCH_FAILED] Tool not found');
  });

  test('toDisplayString includes suggestion when provided', () => {
    const error = new AgentError(
      'TOOL_DISPATCH_FAILED',
      'Tool not found',
      {},
      { suggestion: 'Check tool registry for available tools' }
    );
    expect(error.toDisplayString()).toBe(
      '[agent:TOOL_DISPATCH_FAILED] Tool not found — Suggestion: Check tool registry for available tools'
    );
  });

  // Tool dispatch context
  test('TOOL_DISPATCH_FAILED includes tool dispatch details in context', () => {
    const error = new AgentError(
      'TOOL_DISPATCH_FAILED',
      'Tool dispatch failed',
      { toolName: 'memory_read', input: { label: 'goals' } }
    );
    expect(error.context).toBeDefined();
    expect(error.context['toolName']).toBe('memory_read');
    expect(error.context['input']).toEqual({ label: 'goals' });
  });

  // Suggestion handling
  test('forwards suggestion correctly', () => {
    const suggestion = 'Check tool registry for available tools';
    const error = new AgentError(
      'TOOL_DISPATCH_FAILED',
      'Tool dispatch failed',
      {},
      { suggestion }
    );
    expect(error.suggestion).toBe(suggestion);
  });

  // Cause chaining
  test('wraps original error as cause', () => {
    const originalError = new Error('Original error message');
    const error = new AgentError(
      'COMPACTION_FAILED',
      'Compaction failed',
      {},
      { cause: originalError }
    );
    expect(error.cause).toBe(originalError);
  });

  test('default context is empty object when not provided', () => {
    const error = new AgentError('RECALL_FAILED', 'Recall failed');
    expect(error.context).toEqual({});
  });
});
