// pattern: Functional Core

import {describe, test, expect} from 'bun:test';
import {createSnapshotState, hashProviderOutput} from './snapshot.ts';

describe('AC3: Snapshot Modes', () => {
  test('AC3.1 — first call is always full', () => {
    const state = createSnapshotState();

    let content1 = 'recall output';
    let content2 = 'memory output';
    const providers = new Map([
      ['recall', () => content1],
      ['memory', () => content2],
    ]);

    const result = state.computeSnapshot(providers, false);

    expect(result.mode).toBe('full');
    expect(result.content).toBeDefined();
    expect(result.content).toContain('recall output');
    expect(result.content).toContain('memory output');
    expect(result.changedProviders.length).toBe(2);
  });

  test('AC3.2 — reset forces full', () => {
    const state = createSnapshotState();

    const providers = new Map([['recall', () => 'content']]);

    // First call (full)
    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');

    // Second call (same content, should be noop)
    const result2 = state.computeSnapshot(providers, false);
    expect(result2.mode).toBe('noop');

    // Reset and call again
    state.reset();
    const result3 = state.computeSnapshot(providers, false);
    expect(result3.mode).toBe('full');
  });

  test('AC3.3 — subsequent calls with changes produce delta', () => {
    const state = createSnapshotState();

    let recallContent = 'recall v1';
    const providers = new Map([
      ['recall', () => recallContent],
      ['memory', () => 'memory content'],
    ]);

    // First call (full)
    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');

    // Change recall content
    recallContent = 'recall v2';
    const result2 = state.computeSnapshot(providers, false);

    expect(result2.mode).toBe('delta');
    expect(result2.content).toBeDefined();
    expect(result2.content).toContain('recall');
    expect(result2.content).not.toContain('memory content');
    expect(result2.changedProviders).toEqual(['recall']);
  });

  test('AC3.4 — no changes produce noop', () => {
    const state = createSnapshotState();

    const providers = new Map([['recall', () => 'content']]);

    // First call (full)
    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');

    // Second call (identical)
    const result2 = state.computeSnapshot(providers, false);
    expect(result2.mode).toBe('noop');
    expect(result2.content).toBeNull();
    expect(result2.changedProviders.length).toBe(0);
  });

  test('AC3.5 — single provider change in delta', () => {
    const state = createSnapshotState();

    let provider1 = 'p1-v1';
    let provider2 = 'p2-v1';
    let provider3 = 'p3-v1';

    const providers = new Map([
      ['p1', () => provider1],
      ['p2', () => provider2],
      ['p3', () => provider3],
    ]);

    // First call (full)
    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');
    expect(result1.changedProviders.length).toBe(3);

    // Change only p2
    provider2 = 'p2-v2';
    const result2 = state.computeSnapshot(providers, false);

    expect(result2.mode).toBe('delta');
    expect(result2.changedProviders).toEqual(['p2']);
    expect(result2.content).toContain('p2');
    expect(result2.content).not.toContain('p1-v1');
    expect(result2.content).not.toContain('p3-v1');
  });
});

describe('AC4: Content Hashing', () => {
  test('AC4.1 — uses Bun.hash (returns bigint)', () => {
    const hash1 = hashProviderOutput('test');
    const hash2 = hashProviderOutput('test');

    expect(typeof hash1).toBe('bigint');
    expect(typeof hash2).toBe('bigint');
    expect(hash1).toBe(hash2);
  });

  test('AC4.2 — per-provider hashing', () => {
    const state = createSnapshotState();

    let p1 = 'content1';
    let p2 = 'content2';

    const providers = new Map([
      ['p1', () => p1],
      ['p2', () => p2],
    ]);

    const result1 = state.computeSnapshot(providers, false);
    expect(result1.hashes.get('p1')).not.toBe(result1.hashes.get('p2'));

    // Change only p1
    p1 = 'modified';
    const result2 = state.computeSnapshot(providers, false);

    expect(result2.changedProviders).toEqual(['p1']);
    expect(result2.hashes.get('p1')).not.toBe(result1.hashes.get('p1'));
    expect(result2.hashes.get('p2')).toBe(result1.hashes.get('p2'));
  });

  test('AC4.3 — deterministic hashing', () => {
    const state1 = createSnapshotState();
    const state2 = createSnapshotState();

    const providers1 = new Map([['recall', () => 'same content']]);
    const providers2 = new Map([['recall', () => 'same content']]);

    const result1 = state1.computeSnapshot(providers1, false);
    const result2 = state2.computeSnapshot(providers2, false);

    expect(result1.hashes.get('recall')).toBe(result2.hashes.get('recall'));
  });

  test('AC4.4 — empty string vs undefined are distinct', () => {
    const state = createSnapshotState();

    let p1: string | undefined = '';
    let p2: string | undefined = undefined;

    const providers = new Map([
      ['p1', () => p1],
      ['p2', () => p2],
    ]);

    const result1 = state.computeSnapshot(providers, false);

    // Different hashes for empty string vs undefined
    expect(result1.hashes.get('p1')).not.toBe(result1.hashes.get('p2'));
    expect(result1.changedProviders).toEqual(['p1']);

    // Swap them
    p1 = undefined;
    p2 = '';
    const result2 = state.computeSnapshot(providers, false);

    expect(result2.mode).toBe('delta');
    expect(result2.changedProviders.length).toBe(2);
  });
});

describe('Additional edge cases', () => {
  test('all providers return undefined on first call', () => {
    const state = createSnapshotState();

    const providers = new Map([
      ['p1', () => undefined],
      ['p2', () => undefined],
    ]);

    const result = state.computeSnapshot(providers, false);

    expect(result.mode).toBe('full');
    expect(result.content).toBeNull();
    expect(result.changedProviders.length).toBe(0);
  });

  test('provider added between calls', () => {
    const state = createSnapshotState();

    const providers1 = new Map<string, () => string | undefined>([['p1', () => 'content1']]);

    const result1 = state.computeSnapshot(providers1, false);
    expect(result1.mode).toBe('full');

    const providers2 = new Map<string, () => string | undefined>([
      ['p1', () => 'content1'],
      ['p2', () => 'content2'],
    ]);

    const result2 = state.computeSnapshot(providers2, false);

    expect(result2.mode).toBe('delta');
    expect(result2.changedProviders).toContain('p2');
  });

  test('provider removed between calls', () => {
    const state = createSnapshotState();

    let providers = new Map([
      ['p1', () => 'content1'],
      ['p2', () => 'content2'],
    ]);

    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');

    // Remove p2
    providers = new Map([['p1', () => 'content1']]);
    const result2 = state.computeSnapshot(providers, false);

    expect(result2.mode).toBe('noop');
  });

  test('forceFullSnapshot flag triggers full mode', () => {
    const state = createSnapshotState();

    const providers = new Map([['p1', () => 'content']]);

    const result1 = state.computeSnapshot(providers, false);
    expect(result1.mode).toBe('full');

    // Same content, but force full
    const result2 = state.computeSnapshot(providers, true);
    expect(result2.mode).toBe('full');
  });
});
