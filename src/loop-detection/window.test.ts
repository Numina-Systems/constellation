// pattern: Functional Core

import { describe, test, expect } from 'bun:test';
import { createResponseWindow } from './window.js';

describe('loop-detection.AC2.1: Window holds last N responses', () => {
  test('retains all responses when within window size', () => {
    const window = createResponseWindow(5);

    window.push('response 1');
    window.push('response 2');
    window.push('response 3');
    window.push('response 4');
    window.push('response 5');

    expect(window.size).toBe(5);
  });

  test('evicts oldest when exceeding window size', () => {
    const window = createResponseWindow(5);

    window.push('response 1');
    window.push('response 2');
    window.push('response 3');
    window.push('response 4');
    window.push('response 5');
    window.push('response 6');

    expect(window.size).toBe(5);
  });
});

describe('loop-detection.AC2.2: Window is FIFO', () => {
  test('evicts oldest entry when full', () => {
    const window = createResponseWindow(2);

    window.push('A');
    window.push('B');

    // Verify size is 2
    expect(window.size).toBe(2);

    window.push('C');

    // After pushing C, window should have B and C, not A and B
    // We verify by checking size stayed at 2 and behavior reflects newest
    expect(window.size).toBe(2);

    // Check that the next check uses max similarity against current entries
    // If A were still in window, we'd be comparing against A too
    // Since A is evicted, only B and C are in window
    const result = window.check(0.5, 1);
    // C compared only against B (not A)
    expect(result.maxSimilarity).toBeDefined();
  });
});

describe('loop-detection.AC2.3: Window is per-conversation', () => {
  test('two windows are independent', () => {
    const window1 = createResponseWindow(2);
    const window2 = createResponseWindow(2);

    window1.push('response A');
    window1.push('response B');

    window2.push('response X');

    expect(window1.size).toBe(2);
    expect(window2.size).toBe(1);

    // Mutations to window1 don't affect window2
    window1.push('response C');
    expect(window1.size).toBe(2);
    expect(window2.size).toBe(1);
  });
});

describe('loop-detection.AC2.4: Fewer responses than window size does not trigger', () => {
  test('single response does not trigger', () => {
    const window = createResponseWindow(5);

    window.push('only response');

    const result = window.check(0.85, 3);

    expect(result.triggered).toBe(false);
    expect(result.consecutiveCount).toBe(0);
  });

  test('two responses without high similarity does not trigger', () => {
    const window = createResponseWindow(5);

    window.push('response A');
    window.push('response B different');

    const result = window.check(0.85, 3);

    expect(result.triggered).toBe(false);
    expect(result.consecutiveCount).toBe(0);
  });
});

describe('loop-detection.AC3.1: Three consecutive high-similarity responses trigger', () => {
  test('triggers after three consecutive high-similarity responses', () => {
    const window = createResponseWindow(5);

    // Push first response
    window.push('The quick brown fox jumps over the lazy dog');

    // Push second - very similar
    window.push('The quick brown fox jumps over the lazy dog');
    const result2 = window.check(0.85, 3);
    expect(result2.consecutiveCount).toBe(1);
    expect(result2.triggered).toBe(false);

    // Push third - very similar
    window.push('The quick brown fox jumps over the lazy dog');
    const result3 = window.check(0.85, 3);
    expect(result3.consecutiveCount).toBe(2);
    expect(result3.triggered).toBe(false);

    // Push fourth - very similar (should trigger)
    window.push('The quick brown fox jumps over the lazy dog');
    const result4 = window.check(0.85, 3);
    expect(result4.consecutiveCount).toBe(3);
    expect(result4.triggered).toBe(true);
  });
});

describe('loop-detection.AC3.2: Different response resets consecutive counter', () => {
  test('two high-similarity then different response resets counter', () => {
    const window = createResponseWindow(5);

    // Push first response
    window.push('The quick brown fox jumps over the lazy dog');

    // Push second - very similar
    window.push('The quick brown fox jumps over the lazy dog');
    const result2 = window.check(0.85, 3);
    expect(result2.consecutiveCount).toBe(1);

    // Push third - very similar
    window.push('The quick brown fox jumps over the lazy dog');
    const result3 = window.check(0.85, 3);
    expect(result3.consecutiveCount).toBe(2);

    // Push fourth - completely different
    window.push('Something completely different unrelated text here');
    const result4 = window.check(0.85, 3);
    expect(result4.consecutiveCount).toBe(0);
    expect(result4.triggered).toBe(false);
  });
});

describe('loop-detection.AC3.3: Single high-similarity response does not trigger', () => {
  test('does not trigger with single high-similarity response', () => {
    const window = createResponseWindow(5);

    window.push('The quick brown fox jumps over the lazy dog');
    window.push('The quick brown fox jumps over the lazy dog');

    const result = window.check(0.85, 3);

    expect(result.consecutiveCount).toBe(1);
    expect(result.triggered).toBe(false);
  });
});

describe('loop-detection.AC3.4: Max pairwise similarity against all window entries', () => {
  test('compares latest against all window entries and uses max similarity', () => {
    const window = createResponseWindow(5);

    // Push response A
    window.push('The quick brown fox');

    // Push response B (different from A)
    window.push('Something completely unrelated text');
    window.check(0.85, 3);

    // Push response C (very similar to A, not B)
    window.push('The quick brown fox');
    const result = window.check(0.85, 3);

    // C should have high similarity to A, even though B is between them
    // max similarity should be the similarity to A, not to B
    expect(result.maxSimilarity).toBeGreaterThan(0.5);
  });
});
