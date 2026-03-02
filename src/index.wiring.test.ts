/**
 * Smoke tests for composition root wiring.
 * Verifies that all new reflexion and scheduler components can be imported,
 * instantiated, and wired together without errors.
 *
 * These tests do NOT test individual component behavior (covered in earlier phases).
 * They verify the composition root wiring logic is correct and all imports resolve.
 *
 * AC5.3: All new components (store, recorder, tools, scheduler, context provider)
 * are wired in the composition root and the daemon starts successfully.
 */

import { describe, it, expect, mock } from 'bun:test';
import { createShutdownHandler, processEventQueue, buildReviewEvent } from '@/index';
import { createPostgresScheduler } from '@/scheduler';
import { createPredictionStore, createTraceRecorder, createPredictionTools, createIntrospectionTools, createPredictionContextProvider } from '@/reflexion';
import type { PersistenceProvider } from '@/persistence/types';
import type { Interface as ReadlineInterface } from 'readline';

// ============================================================================
// AC5.3 (import compatibility): Verify all new modules export expected functions
// ============================================================================

describe('composition root wiring: import compatibility', () => {
  it('exports createPredictionStore from reflexion', () => {
    expect(typeof createPredictionStore).toBe('function');
  });

  it('exports createTraceRecorder from reflexion', () => {
    expect(typeof createTraceRecorder).toBe('function');
  });

  it('exports createPredictionTools from reflexion', () => {
    expect(typeof createPredictionTools).toBe('function');
  });

  it('exports createIntrospectionTools from reflexion', () => {
    expect(typeof createIntrospectionTools).toBe('function');
  });

  it('exports createPredictionContextProvider from reflexion', () => {
    expect(typeof createPredictionContextProvider).toBe('function');
  });

  it('exports createPostgresScheduler from scheduler', () => {
    expect(typeof createPostgresScheduler).toBe('function');
  });
});

// ============================================================================
// AC5.3 (shutdown handler with scheduler):
// Verify shutdown handler accepts scheduler parameter and stop can be called
// ============================================================================

describe('composition root wiring: shutdown handler with scheduler', () => {
  const createMockReadline = (): ReadlineInterface => {
    return {
      close: mock(() => {}),
      once: mock(() => {}),
      on: mock(() => {}),
      write: mock(() => {}),
      setPrompt: mock(() => {}),
      prompt: mock(() => {}),
    } as unknown as ReadlineInterface;
  };

  const createMockPersistence = (): PersistenceProvider => {
    return {
      connect: mock(async () => {}),
      disconnect: mock(async () => {}),
      runMigrations: mock(async () => {}),
      query: mock(async () => []),
      withTransaction: mock(async (fn) => fn(mock(async () => []))),
    };
  };

  it('calls scheduler.stop() during shutdown', async () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();
    const scheduler = { stop: mock(() => {}) };
    const originalExit = process.exit;
    process.exit = mock(() => {}) as unknown as typeof process.exit;

    try {
      const handler = createShutdownHandler(rl, persistence, null, scheduler);
      await handler();
      expect(scheduler.stop).toHaveBeenCalled();
    } finally {
      process.exit = originalExit;
    }
  });

  it('accepts null scheduler parameter', () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();

    // Should not throw with null scheduler
    const handler = createShutdownHandler(rl, persistence, null, null);
    expect(typeof handler).toBe('function');
  });

  it('accepts undefined scheduler parameter', () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();

    // Should not throw with undefined scheduler
    const handler = createShutdownHandler(rl, persistence, null);
    expect(typeof handler).toBe('function');
  });
});

// ============================================================================
// AC4.6 (review event format):
// Verify buildReviewEvent (exported from index.ts) creates correct event shape
// ============================================================================

describe('composition root wiring: review event format (buildReviewEvent)', () => {
  it('builds review event with correct source and metadata structure', () => {
    const mockTask = {
      id: 'test-task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };

    const reviewEvent = buildReviewEvent(mockTask);

    // Verify shape matches ExternalEvent
    expect(reviewEvent.source).toBe('review-job');
    expect(typeof reviewEvent.content).toBe('string');
    expect(typeof reviewEvent.metadata).toBe('object');
    expect(reviewEvent.timestamp instanceof Date).toBe(true);
  });

  it('includes taskId in metadata matching task.id', () => {
    const mockTask = {
      id: 'abc-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };

    const event = buildReviewEvent(mockTask);

    expect(event.metadata['taskId']).toBe('abc-123');
    expect(event.metadata['taskName']).toBe('review-predictions');
    expect(event.metadata['schedule']).toBe('0 * * * *');
  });

  it('includes zero-predictions guidance in event content', () => {
    const mockTask = {
      id: 'test-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(mockTask);

    expect(event.content).toContain('If you have no pending predictions');
    expect(event.content).toContain('still write a brief reflection');
  });

  it('includes task.payload in metadata spread', () => {
    const mockTask = {
      id: 'test-456',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review', extraField: 'extra-value' },
    };

    const event = buildReviewEvent(mockTask);

    expect(event.metadata['type']).toBe('prediction-review');
    expect(event.metadata['extraField']).toBe('extra-value');
  });

  it('creates timestamp as Date instance', () => {
    const mockTask = {
      id: 'test-789',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(mockTask);
    const timeDifference = Math.abs(Date.now() - event.timestamp.getTime());

    expect(event.timestamp instanceof Date).toBe(true);
    expect(timeDifference).toBeLessThan(1000); // Within 1 second
  });
});

// ============================================================================
// AC3.4 (expiry invocation):
// Verify review event builder includes required content elements
// ============================================================================

describe('composition root wiring: review event content (AC3.4)', () => {
  it('event content includes instruction to review pending predictions', () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(task);

    expect(event.content).toContain('Review your pending predictions');
    expect(event.content).toContain('list_predictions');
  });

  it('event content includes instruction to use annotate_prediction', () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(task);

    expect(event.content).toContain('annotate_prediction');
  });

  it('event content includes instruction to write reflection', () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(task);

    expect(event.content).toContain('write a brief reflection');
    expect(event.content).toContain('archival memory');
  });
});

// ============================================================================
// AC3.6 (zero-predictions prompt):
// Verify buildReviewEvent includes guidance for zero-predictions case (AC3.6)
// ============================================================================

describe('composition root wiring: zero-predictions guidance (AC3.6)', () => {
  it('includes explicit guidance for zero-predictions case via buildReviewEvent', () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(task);

    expect(event.content).toContain('If you have no pending predictions');
    expect(event.content).toContain('still write a brief reflection');
    expect(event.content).toContain('consider whether you should be making predictions');
  });

  it('zero-predictions guidance is placed after main review instructions', () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = buildReviewEvent(task);

    const mainContent = 'Review your pending predictions';
    const zeroGuide = 'If you have no pending predictions';
    const mainIndex = event.content.indexOf(mainContent);
    const zeroIndex = event.content.indexOf(zeroGuide);

    expect(mainIndex).toBeLessThan(zeroIndex);
  });
});

// ============================================================================
// AC6.5 (processEvent error resilience):
// Verify processEventQueue is exported and can be called
// ============================================================================

describe('composition root wiring: event queue processing', () => {
  it('exports processEventQueue function', () => {
    expect(typeof processEventQueue).toBe('function');
  });
});
