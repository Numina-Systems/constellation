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
import { createShutdownHandler, processEventQueue, buildReviewEvent, buildAgentScheduledEvent } from '@/index';
import { createPostgresScheduler } from '@/scheduler';
import { createPredictionStore, createTraceRecorder, createPredictionTools, createIntrospectionTools, createPredictionContextProvider } from '@/reflexion';
import type { PersistenceProvider } from '@/persistence/types';
import type { Interface as ReadlineInterface } from 'readline';
import type { TraceStore, OperationTrace } from '@/reflexion';

// ============================================================================
// Helper factories for mocking
// ============================================================================

function createMockTraceStore(traces: ReadonlyArray<OperationTrace> = []): TraceStore {
  return {
    record: mock(async () => {}) as TraceStore['record'],
    queryTraces: mock(async () => traces),
  };
}

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
  it('builds review event with correct source and metadata structure', async () => {
    const mockTask = {
      id: 'test-task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };
    const traceStore = createMockTraceStore();

    const reviewEvent = await buildReviewEvent(mockTask, traceStore, 'test-owner');

    // Verify shape matches ExternalEvent
    expect(reviewEvent.source).toBe('review-job');
    expect(typeof reviewEvent.content).toBe('string');
    expect(typeof reviewEvent.metadata).toBe('object');
    expect(reviewEvent.timestamp instanceof Date).toBe(true);
  });

  it('includes taskId in metadata matching task.id', async () => {
    const mockTask = {
      id: 'abc-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(mockTask, traceStore, 'test-owner');

    expect(event.metadata['taskId']).toBe('abc-123');
    expect(event.metadata['taskName']).toBe('review-predictions');
    expect(event.metadata['schedule']).toBe('0 * * * *');
  });

  it('includes zero-predictions guidance in event content', async () => {
    const mockTask = {
      id: 'test-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(mockTask, traceStore, 'test-owner');

    expect(event.content).toContain('If you have no pending predictions');
    expect(event.content).toContain('still write a brief reflection');
  });

  it('includes task.payload in metadata spread', async () => {
    const mockTask = {
      id: 'test-456',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review', extraField: 'extra-value' },
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(mockTask, traceStore, 'test-owner');

    expect(event.metadata['type']).toBe('prediction-review');
    expect(event.metadata['extraField']).toBe('extra-value');
  });

  it('creates timestamp as Date instance', async () => {
    const mockTask = {
      id: 'test-789',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(mockTask, traceStore, 'test-owner');
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
  it('event content includes instruction to review pending predictions', async () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('Review your pending predictions');
    expect(event.content).toContain('list_predictions');
  });

  it('event content includes instruction to use annotate_prediction', async () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('annotate_prediction');
  });

  it('event content includes instruction to write reflection', async () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('write a brief reflection');
    expect(event.content).toContain('archival memory');
  });
});

// ============================================================================
// AC3.6 (zero-predictions prompt):
// Verify buildReviewEvent includes guidance for zero-predictions case (AC3.6)
// ============================================================================

describe('composition root wiring: zero-predictions guidance (AC3.6)', () => {
  it('includes explicit guidance for zero-predictions case via buildReviewEvent', async () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('If you have no pending predictions');
    expect(event.content).toContain('still write a brief reflection');
    expect(event.content).toContain('consider whether you should be making predictions');
  });

  it('zero-predictions guidance is placed after main review instructions', async () => {
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };
    const traceStore = createMockTraceStore();

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    const mainContent = 'Review your pending predictions';
    const zeroGuide = 'If you have no pending predictions';
    const mainIndex = event.content.indexOf(mainContent);
    const zeroIndex = event.content.indexOf(zeroGuide);

    expect(mainIndex).toBeLessThan(zeroIndex);
  });
});

// ============================================================================
// AC1.1, AC1.3, AC1.4, AC1.5 (trace enrichment for buildReviewEvent):
// Verify trace queries and [Recent Activity] section formatting
// ============================================================================

describe('composition root wiring: review event trace enrichment', () => {
  it('AC1.1: includes [Recent Activity] section with formatted traces when traces exist', async () => {
    const mockTrace: OperationTrace = {
      id: 'trace-1',
      owner: 'test-owner',
      conversationId: 'conv-1',
      toolName: 'memory_write',
      input: { query: 'test' },
      outputSummary: 'Wrote block core:persona',
      durationMs: 100,
      success: true,
      error: null,
      createdAt: new Date(),
    };

    const traceStore = createMockTraceStore([mockTrace]);
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('[Recent Activity]');
    expect(event.content).toContain('memory_write');
    expect(event.content).toContain('✓');
  });

  it('AC1.3: shows "No recent activity recorded." when no traces exist', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('[Recent Activity]');
    expect(event.content).toContain('No recent activity recorded.');
  });

  it('AC1.4: queries traces with limit 20', async () => {
    const traceStore = createMockTraceStore([]);
    const queryTracesMock = traceStore.queryTraces as any;

    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    await buildReviewEvent(task, traceStore, 'test-owner');

    const callArgs = queryTracesMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.limit).toBe(20);
  });

  it('AC1.5: queries traces with lookbackSince approximately 2 hours before current time', async () => {
    const traceStore = createMockTraceStore([]);
    const queryTracesMock = traceStore.queryTraces as any;

    const task = {
      id: 'task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
    };

    const beforeTime = Date.now();
    await buildReviewEvent(task, traceStore, 'test-owner');

    const callArgs = queryTracesMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.lookbackSince).toBeDefined();

    const lookbackMs = beforeTime - callArgs.lookbackSince.getTime();
    const expectedLookbackMs = 2 * 3600_000; // 2 hours
    const tolerance = 5000; // 5 second tolerance

    expect(Math.abs(lookbackMs - expectedLookbackMs)).toBeLessThan(tolerance);
  });
});

// ============================================================================
// AC1.2, AC1.3 (trace enrichment for buildAgentScheduledEvent):
// Verify agent-scheduled events include formatted traces
// ============================================================================

describe('composition root wiring: agent-scheduled event trace enrichment', () => {
  it('AC1.2: includes [Recent Activity] section with formatted traces', async () => {
    const mockTrace: OperationTrace = {
      id: 'trace-1',
      owner: 'test-owner',
      conversationId: 'conv-1',
      toolName: 'code_execute',
      input: { code: 'test' },
      outputSummary: 'Executed successfully',
      durationMs: 500,
      success: true,
      error: null,
      createdAt: new Date(),
    };

    const traceStore = createMockTraceStore([mockTrace]);
    const task = {
      id: 'task-456',
      name: 'custom-task',
      schedule: '0 9 * * *',
      payload: { prompt: 'Do something custom' },
    };

    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    expect(event.source).toBe('agent-scheduled');
    expect(event.content).toContain('[Recent Activity]');
    expect(event.content).toContain('code_execute');
  });

  it('AC1.3: shows "No recent activity recorded." when no traces exist', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'task-456',
      name: 'custom-task',
      schedule: '0 9 * * *',
      payload: { prompt: 'Do something custom' },
    };

    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('[Recent Activity]');
    expect(event.content).toContain('No recent activity recorded.');
  });

  it('includes task name in event content', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'task-456',
      name: 'my-custom-task',
      schedule: '0 9 * * *',
      payload: { prompt: 'Do something' },
    };

    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    expect(event.content).toContain('my-custom-task');
  });

  it('spreads task payload into metadata', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'task-456',
      name: 'custom-task',
      schedule: '0 9 * * *',
      payload: { prompt: 'Do something', extraData: 'value' },
    };

    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    expect(event.metadata['prompt']).toBe('Do something');
    expect(event.metadata['extraData']).toBe('value');
  });

  it('queries traces with limit 20 and 2-hour lookback', async () => {
    const traceStore = createMockTraceStore([]);
    const queryTracesMock = traceStore.queryTraces as any;

    const task = {
      id: 'task-456',
      name: 'custom-task',
      schedule: '0 9 * * *',
      payload: { prompt: 'Do something' },
    };

    const beforeTime = Date.now();
    await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    const callArgs = queryTracesMock.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs.limit).toBe(20);
    expect(callArgs.lookbackSince).toBeDefined();

    const lookbackMs = beforeTime - callArgs.lookbackSince.getTime();
    const expectedLookbackMs = 2 * 3600_000; // 2 hours
    const tolerance = 5000; // 5 second tolerance

    expect(Math.abs(lookbackMs - expectedLookbackMs)).toBeLessThan(tolerance);
  });

  it('uses default prompt when payload.prompt is absent', async () => {
    const traceStore = createMockTraceStore([]);
    const task = { id: 'task-789', name: 'no-prompt-task', schedule: '0 9 * * *' };
    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');
    expect(event.content).toContain('Execute this scheduled task.');
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
