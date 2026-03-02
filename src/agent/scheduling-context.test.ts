// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { createSchedulingContextProvider } from './scheduling-context';

describe('createSchedulingContextProvider', () => {
  it('returns undefined when both lists are empty', () => {
    const provider = createSchedulingContextProvider([], []);
    const result = provider();
    expect(result).toBeUndefined();
  });

  it('includes watched_dids when provided', () => {
    const watchedDids = ['did:plc:alice123', 'did:plc:bob456'];
    const provider = createSchedulingContextProvider([], watchedDids);
    const result = provider();

    expect(result).toBeDefined();
    expect((result ?? '').includes('[DID Authority]')).toBe(true);
    expect((result ?? '').includes('Watched DIDs (full interaction): did:plc:alice123, did:plc:bob456')).toBe(true);
  });

  it('includes schedule_dids when provided', () => {
    const scheduleDids = ['did:plc:charlie789'];
    const provider = createSchedulingContextProvider(scheduleDids, []);
    const result = provider();

    expect(result).toBeDefined();
    expect((result ?? '').includes('[DID Authority]')).toBe(true);
    expect((result ?? '').includes('Schedule DIDs (scheduling only): did:plc:charlie789')).toBe(true);
  });

  it('includes scheduling-only instruction when there are schedule-only DIDs', () => {
    const scheduleDids = ['did:plc:charlie789'];
    const watchedDids: ReadonlyArray<string> = [];
    const provider = createSchedulingContextProvider(scheduleDids, watchedDids);
    const result = provider();

    expect(result).toBeDefined();
    expect((result ?? '').includes('When a message comes from a schedule-only DID, process only scheduling requests. Do not engage in general conversation.')).toBe(true);
  });

  it('omits scheduling-only instruction when all schedule_dids are also in watched_dids', () => {
    const scheduleDids = ['did:plc:alice123'];
    const watchedDids = ['did:plc:alice123', 'did:plc:bob456'];
    const provider = createSchedulingContextProvider(scheduleDids, watchedDids);
    const result = provider();

    expect(result).toBeDefined();
    expect((result ?? '').includes('[DID Authority]')).toBe(true);
    expect((result ?? '').includes('Watched DIDs (full interaction): did:plc:alice123, did:plc:bob456')).toBe(true);
    expect((result ?? '').includes('Schedule DIDs (scheduling only): did:plc:alice123')).toBe(true);
    expect((result ?? '').includes('When a message comes from a schedule-only DID')).toBe(false);
  });

  it('includes scheduling-only instruction mentioning only non-watched DIDs', () => {
    const scheduleDids = ['did:plc:alice123', 'did:plc:charlie789'];
    const watchedDids = ['did:plc:alice123', 'did:plc:bob456'];
    const provider = createSchedulingContextProvider(scheduleDids, watchedDids);
    const result = provider();

    expect(result).toBeDefined();
    expect((result ?? '').includes('[DID Authority]')).toBe(true);
    expect((result ?? '').includes('Watched DIDs (full interaction): did:plc:alice123, did:plc:bob456')).toBe(true);
    expect((result ?? '').includes('Schedule DIDs (scheduling only): did:plc:alice123, did:plc:charlie789')).toBe(true);
    expect((result ?? '').includes('When a message comes from a schedule-only DID, process only scheduling requests. Do not engage in general conversation.')).toBe(true);
  });

  it('returns properly formatted output with both lists', () => {
    const scheduleDids = ['did:plc:scheduler1'];
    const watchedDids = ['did:plc:watcher1'];
    const provider = createSchedulingContextProvider(scheduleDids, watchedDids);
    const result = provider();

    expect(result).toBeDefined();
    const lines = (result ?? '').split('\n');
    expect(lines[0]).toBe('[DID Authority]');
    expect(lines[1]).toContain('Watched DIDs');
    expect(lines[2]).toContain('Schedule DIDs');
    expect(lines.length).toBeGreaterThan(3);
  });

  it('returns a string result each time it is called', () => {
    const scheduleDids = ['did:plc:charlie789'];
    const watchedDids = ['did:plc:alice123'];
    const provider = createSchedulingContextProvider(scheduleDids, watchedDids);

    const result1 = provider();
    const result2 = provider();

    expect(result1).toBe(result2);
  });
});
