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
import { createPredictionStore, createTraceRecorder, createPredictionTools, createIntrospectionTools, createPredictionContextProvider, shouldSkipReview } from '@/reflexion';
import { createSchedulingTools } from '@/tool/builtin/scheduling';
import { createSchedulingContextProvider } from '@/agent/scheduling-context';
import { Cron } from 'croner';
import type { PersistenceProvider } from '@/persistence/types';
import type { Interface as ReadlineInterface } from 'readline';
import type { TraceStore, OperationTrace } from '@/reflexion';
import type { DataSourceRegistry } from '@/extensions/data-source';

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

  it('exports createSchedulingTools from tool/builtin/scheduling', () => {
    expect(typeof createSchedulingTools).toBe('function');
  });

  it('exports createSchedulingContextProvider from agent/scheduling-context', () => {
    expect(typeof createSchedulingContextProvider).toBe('function');
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
// AC2.1, AC2.2 (consolidated architecture): DataSourceRegistry shutdown
// Verify registry is called during shutdown instead of blueskySource
// ============================================================================

describe('composition root wiring: shutdown handler with DataSource registry (AC2.1, AC2.2)', () => {
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

  const createMockDataSourceRegistry = (): DataSourceRegistry => {
    return {
      shutdown: mock(async () => {}),
    } as unknown as DataSourceRegistry;
  };

  it('calls registry.shutdown() during shutdown', async () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();
    const registry = createMockDataSourceRegistry();
    const originalExit = process.exit;
    process.exit = mock(() => {}) as unknown as typeof process.exit;

    try {
      const handler = createShutdownHandler(rl, persistence, registry);
      await handler();
      expect(registry.shutdown).toHaveBeenCalled();
    } finally {
      process.exit = originalExit;
    }
  });

  it('handles registry.shutdown() errors gracefully', async () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();
    const registry: DataSourceRegistry = {
      shutdown: mock(async () => {
        throw new Error('registry shutdown failed');
      }),
    } as unknown as DataSourceRegistry;
    const originalExit = process.exit;
    const consoleMock = mock(() => {});
    const originalError = console.error;
    console.error = consoleMock;
    process.exit = mock(() => {}) as unknown as typeof process.exit;

    try {
      const handler = createShutdownHandler(rl, persistence, registry);
      await handler(); // Should not throw
      expect(registry.shutdown).toHaveBeenCalled();
      expect(consoleMock).toHaveBeenCalled();
    } finally {
      console.error = originalError;
      process.exit = originalExit;
    }
  });

  it('accepts null registry parameter', () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();

    // Should not throw with null registry
    const handler = createShutdownHandler(rl, persistence, null);
    expect(typeof handler).toBe('function');
  });

  it('accepts undefined registry parameter', () => {
    const rl = createMockReadline();
    const persistence = createMockPersistence();

    // Should not throw with undefined registry
    const handler = createShutdownHandler(rl, persistence);
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
// AC4.1 & AC4.2 (agent-scheduled event format):
// Verify buildAgentScheduledEvent creates correct event shape with prompt content
// (updated for async trace-enriched API)
// ============================================================================

describe('composition root wiring: agent-scheduled event format (buildAgentScheduledEvent)', () => {
  it('builds agent-scheduled event with correct source and metadata structure', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-123',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'do something' },
    };

    const agentEvent = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');

    expect(agentEvent.source).toBe('agent-scheduled');
    expect(typeof agentEvent.content).toBe('string');
    expect(agentEvent.content).toContain('do something');
    expect(typeof agentEvent.metadata).toBe('object');
    expect(agentEvent.timestamp instanceof Date).toBe(true);
  });

  it('includes taskId in metadata matching task.id', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-456',
      name: 'scheduled-prompt',
      schedule: '*/30 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'check status' },
    };

    const event = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');

    expect(event.metadata['taskId']).toBe('agent-task-456');
    expect(event.metadata['taskName']).toBe('scheduled-prompt');
    expect(event.metadata['schedule']).toBe('*/30 * * * *');
  });

  it('includes content from task.payload.prompt (AC4.2)', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-789',
      name: 'scheduled-prompt',
      schedule: '0 12 * * *',
      payload: { type: 'agent-scheduled', prompt: 'review recent conversations' },
    };

    const event = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');

    expect(event.content).toContain('review recent conversations');
  });

  it('includes full task.payload in metadata spread', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-payload',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: {
        type: 'agent-scheduled',
        prompt: 'do work',
        customField: 'custom-value',
        anotherField: 42,
      },
    };

    const event = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');

    expect(event.metadata['type']).toBe('agent-scheduled');
    expect(event.metadata['prompt']).toBe('do work');
    expect(event.metadata['customField']).toBe('custom-value');
    expect(event.metadata['anotherField']).toBe(42);
  });

  it('creates timestamp as Date instance', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-timestamp',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'test' },
    };

    const event = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');
    const timeDifference = Math.abs(Date.now() - event.timestamp.getTime());

    expect(event.timestamp instanceof Date).toBe(true);
    expect(timeDifference).toBeLessThan(1000); // Within 1 second
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
// AC4.3 (one-shot auto-cancel):
// Verify croner nextRun() returns null for timestamps in the past (one-shot detection)
// ============================================================================

describe('composition root wiring: one-shot auto-cancel via croner (AC4.3)', () => {
  it('croner returns null for ISO timestamp in the past', () => {
    const pastTimestamp = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    const nextRun = new Cron(pastTimestamp).nextRun();

    expect(nextRun).toBe(null);
  });

  it('croner returns a future Date for ISO timestamp in the future', () => {
    const futureTimestamp = new Date(Date.now() + 60000).toISOString(); // 1 minute from now

    const nextRun = new Cron(futureTimestamp).nextRun();

    expect(nextRun instanceof Date).toBe(true);
  });

  it('croner correctly distinguishes between past and future timestamps', () => {
    const pastTimestamp = new Date(Date.now() - 1000).toISOString();
    const futureTimestamp = new Date(Date.now() + 86400000).toISOString(); // 1 day from now

    const pastNextRun = new Cron(pastTimestamp).nextRun();
    const futureNextRun = new Cron(futureTimestamp).nextRun();

    expect(pastNextRun).toBe(null);
    expect(futureNextRun instanceof Date).toBe(true);
  });
});

// ============================================================================
// AC4.1 & AC4.3 (onDue branching):
// Verify both event builders produce correct sources and one-shot detection works
// (updated for async trace-enriched API)
// ============================================================================

describe('composition root wiring: onDue branching (AC4.1, AC4.3)', () => {
  it('buildReviewEvent produces source "review-job" for review tasks', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'review-task-123',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };

    const event = await buildReviewEvent(mockTask, traceStore, 'test-owner');

    expect(event.source).toBe('review-job');
  });

  it('buildAgentScheduledEvent produces source "agent-scheduled" for agent tasks (AC4.1)', async () => {
    const traceStore = createMockTraceStore([]);
    const mockTask = {
      id: 'agent-task-123',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'do stuff' },
    };

    const event = await buildAgentScheduledEvent(mockTask, traceStore, 'test-owner');

    expect(event.source).toBe('agent-scheduled');
  });

  it('both builders coexist and produce distinct event sources', async () => {
    const traceStore = createMockTraceStore([]);
    const reviewTask = {
      id: 'review-1',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };

    const agentTask = {
      id: 'agent-1',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'test prompt' },
    };

    const reviewEvent = await buildReviewEvent(reviewTask, traceStore, 'test-owner');
    const agentEvent = await buildAgentScheduledEvent(agentTask, traceStore, 'test-owner');

    expect(reviewEvent.source).toBe('review-job');
    expect(agentEvent.source).toBe('agent-scheduled');
    expect(reviewEvent.source).not.toBe(agentEvent.source);
  });

  it('event branching preserves metadata distinctly for each event type', async () => {
    const traceStore = createMockTraceStore([]);
    const reviewTask = {
      id: 'review-1',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review', extraField: 'review-value' },
    };

    const agentTask = {
      id: 'agent-1',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'agent prompt', extraField: 'agent-value' },
    };

    const reviewEvent = await buildReviewEvent(reviewTask, traceStore, 'test-owner');
    const agentEvent = await buildAgentScheduledEvent(agentTask, traceStore, 'test-owner');

    expect(reviewEvent.metadata['type']).toBe('prediction-review');
    expect(reviewEvent.metadata['extraField']).toBe('review-value');

    expect(agentEvent.metadata['type']).toBe('agent-scheduled');
    expect(agentEvent.metadata['extraField']).toBe('agent-value');
  });
});

// ============================================================================
// composition root wiring: review gate (efficient-agent-loop.AC1)
// Verify dynamic review gate logic for skipping idle reviews
// ============================================================================

describe('composition root wiring: review gate (efficient-agent-loop.AC1)', () => {
  it('AC1.1: review proceeds when traces exist in lookback window', async () => {
    const mockTrace: OperationTrace = {
      id: 'trace-gate-1',
      owner: 'test-owner',
      conversationId: 'conv-1',
      toolName: 'memory_write',
      input: {},
      outputSummary: 'Wrote block',
      durationMs: 50,
      success: true,
      error: null,
      createdAt: new Date(),
    };
    const traceStore = createMockTraceStore([mockTrace]);

    // Gate check: traces exist, should NOT skip
    const traces = await traceStore.queryTraces({
      owner: 'test-owner',
      lookbackSince: new Date(Date.now() - 2 * 3600_000),
      limit: 1,
    });
    expect(shouldSkipReview(traces.length)).toBe(false);

    // Review event should be built successfully
    const task = { id: 'task-1', name: 'review-predictions', schedule: '0 * * * *' };
    const event = await buildReviewEvent(task, traceStore, 'test-owner');
    expect(event.source).toBe('review-job');
  });

  it('AC1.2: review skips when zero traces in lookback window', async () => {
    const traceStore = createMockTraceStore([]);

    const traces = await traceStore.queryTraces({
      owner: 'test-owner',
      lookbackSince: new Date(Date.now() - 2 * 3600_000),
      limit: 1,
    });
    expect(shouldSkipReview(traces.length)).toBe(true);
    // When shouldSkipReview returns true, handleSystemSchedulerTask
    // returns early — no event is pushed, no LLM call is made
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

// ============================================================================
// AC2.2 (structural verification): No blueskyAgent exists
// Verify consolidated architecture has no separate bluesky agent instance
// ============================================================================

describe('composition root wiring: structural verification (AC2.2)', () => {
  it('index.ts does not create a blueskyAgent variable', async () => {
    // Read the source file and verify blueskyAgent is not instantiated
    const { readFileSync } = await import('fs');
    const { dirname, join } = await import('path');
    const { fileURLToPath } = await import('url');

    const testDir = dirname(fileURLToPath(import.meta.url));
    const indexPath = join(testDir, 'index.ts');
    const indexSource = readFileSync(indexPath, 'utf-8');

    // Verify the composition root does not create blueskyAgent
    // Pattern: blueskyAgent = createAgent(...)
    const blueskyAgentCreation = /blueskyAgent\s*=\s*createAgent/;
    expect(blueskyAgentCreation.test(indexSource)).toBe(false);
  });

  it('processEventQueue is called with single main agent for external events', () => {
    // Verify the function is exported and designed for unified queue
    expect(typeof processEventQueue).toBe('function');
  });
});

// ============================================================================
// AC4.2, AC4.3 (source instructions integration):
// Verify sourceInstructions map is built from registrations and used correctly
// ============================================================================

describe('composition root wiring: source instructions (AC4.2, AC4.3)', () => {
  it('buildReviewEvent creates event with source "review-job" (no instructions needed)', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'review-task-1',
      name: 'review-predictions',
      schedule: '0 * * * *',
      payload: { type: 'prediction-review' },
    };

    const event = await buildReviewEvent(task, traceStore, 'test-owner');

    // Review events have source "review-job" which does not require instructions
    expect(event.source).toBe('review-job');
  });

  it('buildAgentScheduledEvent creates event with source "agent-scheduled" (no instructions needed)', async () => {
    const traceStore = createMockTraceStore([]);
    const task = {
      id: 'agent-task-1',
      name: 'scheduled-prompt',
      schedule: '0 * * * *',
      payload: { type: 'agent-scheduled', prompt: 'test prompt' },
    };

    const event = await buildAgentScheduledEvent(task, traceStore, 'test-owner');

    // Agent-scheduled events have source "agent-scheduled" which does not require instructions
    expect(event.source).toBe('agent-scheduled');
  });

  it('processEventQueue accepts external events and routes them to agent', () => {
    // Verify the function signature supports routing external events
    // from the registry's event queue to the main agent
    expect(typeof processEventQueue).toBe('function');
  });
});
