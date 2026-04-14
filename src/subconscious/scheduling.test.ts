import { describe, it, expect } from 'bun:test';
import { buildImpulseCron } from './impulse';
import { createActivityDispatch } from '@/activity/dispatch';
import { SUPPRESS_DURING_SLEEP } from '@/index';
import type { ActivityManager } from '@/activity/types';

describe('subconscious.AC1.1: Impulse scheduling', () => {
  it('buildImpulseCron converts interval_minutes to valid cron expression', () => {
    const cron = buildImpulseCron(20);

    // Verify the function produces a valid 5-part cron expression
    const parts = cron.split(' ');
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe('*/20');
    expect(parts[1]).toBe('*');
    expect(parts[2]).toBe('*');
    expect(parts[3]).toBe('*');
    expect(parts[4]).toBe('*');
  });

  it('buildImpulseCron handles various interval minutes', () => {
    const testCases = [
      { minutes: 5, expected: '*/5 * * * *' },
      { minutes: 10, expected: '*/10 * * * *' },
      { minutes: 15, expected: '*/15 * * * *' },
      { minutes: 30, expected: '*/30 * * * *' },
      { minutes: 60, expected: '*/60 * * * *' },
    ];

    for (const testCase of testCases) {
      const cron = buildImpulseCron(testCase.minutes);
      expect(cron).toBe(testCase.expected);
    }
  });
});

describe('subconscious.AC1.4: Impulse suppression during sleep', () => {
  it('createActivityDispatch suppresses named tasks during sleep', async () => {
    let handlerCalled = false;

    const testHandler = () => {
      handlerCalled = true;
    };

    const mockActivityManager = {
      isActive: async () => false, // Sleeping mode
    } as unknown as ActivityManager;

    const testDispatch = createActivityDispatch({
      activityManager: mockActivityManager,
      originalHandler: testHandler,
      onTransition: () => {
        // no-op
      },
      suppressDuringSleep: ['subconscious-impulse'],
    });

    // Call dispatch with a suppressed task during sleep
    testDispatch({ id: 'task-1', name: 'subconscious-impulse', schedule: '', payload: {} });

    // Flush microtasks to allow the async dispatch to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Handler should NOT have been called during sleep
    expect(handlerCalled).toBe(false);
  });

  it('createActivityDispatch allows tasks during wake hours', async () => {
    let handlerCalled = false;

    const testHandler = () => {
      handlerCalled = true;
    };

    const mockActivityManager = {
      isActive: async () => true, // Active mode
    } as unknown as ActivityManager;

    const testDispatch = createActivityDispatch({
      activityManager: mockActivityManager,
      originalHandler: testHandler,
      onTransition: () => {
        // no-op
      },
      suppressDuringSleep: ['subconscious-impulse'],
    });

    // Call dispatch with a suppressed task during wake hours
    testDispatch({ id: 'task-1', name: 'subconscious-impulse', schedule: '', payload: {} });

    // Flush microtasks to allow the async dispatch to complete
    await new Promise((resolve) => setImmediate(resolve));

    // Handler SHOULD have been called during wake
    expect(handlerCalled).toBe(true);
  });

  it('impulse task name is in suppress list from configuration', () => {
    // Imports actual SUPPRESS_DURING_SLEEP from src/index.ts
    // This verifies that 'subconscious-impulse' is configured to be suppressed during sleep
    expect(SUPPRESS_DURING_SLEEP).toContain('subconscious-impulse');
  });
});
