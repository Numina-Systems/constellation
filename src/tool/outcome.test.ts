import {describe, expect, it} from 'bun:test';
import {isToolOutcome, parseToolOutcome} from './outcome.ts';

describe('ToolOutcome runtime boundary', () => {
  it('accepts bounded success and preserves its shape', () => {
    const outcome = parseToolOutcome({kind: 'success', output: 'done', details: {source: 'test'}});
    expect(outcome).toEqual({kind: 'success', output: 'done', details: {source: 'test'}});
  });

  it('rejects malformed and oversized untrusted values', () => {
    expect(isToolOutcome({kind: 'success', output: 'x'.repeat(64 * 1024 + 1)})).toBe(false);
    expect(isToolOutcome({kind: 'error', code: 'not safe', message: 'failure'})).toBe(false);
    expect(() => parseToolOutcome({kind: 'cancelled', code: 'cancelled', message: 'stopped'})).not.toThrow();
  });
});
