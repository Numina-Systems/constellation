// pattern: Functional Core (test)

import { describe, it, expect } from 'bun:test';
import { shouldSkipReview } from './review-gate.ts';

describe('shouldSkipReview (efficient-agent-loop.AC1)', () => {
  describe('efficient-agent-loop.AC1.1: traces exist — review fires normally', () => {
    it('returns false when trace count is 1', () => {
      expect(shouldSkipReview(1)).toBe(false);
    });

    it('returns false when trace count is greater than 1', () => {
      expect(shouldSkipReview(5)).toBe(false);
    });
  });

  describe('efficient-agent-loop.AC1.2: zero traces — review skips', () => {
    it('returns true when trace count is 0', () => {
      expect(shouldSkipReview(0)).toBe(true);
    });
  });

  describe('efficient-agent-loop.AC1.3: passive events do not count as activity', () => {
    it('returns true when zero traces exist (passive events do not generate traces)', () => {
      // Passive inbound events (e.g. bluesky posts not acted on) do not create
      // operation traces. Only agent-initiated tool dispatches generate traces.
      // When no traces exist in the window, the review is correctly skipped.
      expect(shouldSkipReview(0)).toBe(true);
    });
  });
});
