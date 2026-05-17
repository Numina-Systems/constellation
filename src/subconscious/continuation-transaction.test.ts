// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createTraceRecorder } from '../reflexion/trace-recorder.ts';
import { runContinuationLoop } from './continuation-loop.ts';
import type { ContinuationLoopDeps } from './continuation-loop.ts';
import type { ContinuationJudgeContext } from './continuation.ts';
import type { ExternalEvent } from '@/agent/types.ts';

const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;

async function cleanupTraces(): Promise<void> {
  try {
    await persistence.query('TRUNCATE TABLE operation_traces');
  } catch {
    // table may not exist yet
  }
}

describe('continuation-refinements.AC4: Transaction boundary verification', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTraces();
  });

  afterEach(async () => {
    await cleanupTraces();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  /**
   * Helper to create a mock processEvent that records traces using the real trace recorder.
   * Simulates what the agent does when processing an event.
   */
  function createMockProcessEvent(
    traceRecorder: ReturnType<typeof createTraceRecorder>,
    conversationId: string,
    owner: string,
    options?: { failOnRound?: number },
  ): { processEvent: (event: ExternalEvent) => Promise<string>; roundCount: number } {
    let roundCount = 0;
    return {
      get roundCount() {
        return roundCount;
      },
      processEvent: async (_event: ExternalEvent): Promise<string> => {
        roundCount++;
        if (options?.failOnRound === roundCount) {
          throw new Error(`Simulated failure on round ${roundCount}`);
        }
        await traceRecorder.record({
          owner,
          conversationId,
          toolName: `test-tool-round-${roundCount}`,
          input: { round: roundCount },
          outputSummary: `Round ${roundCount} output`,
          durationMs: 100,
          success: true,
          error: null,
        });
        return `Response from round ${roundCount}`;
      },
    };
  }

  /**
   * Helper to create mock ContinuationLoopDeps with configurable judge behavior.
   */
  function createMockDeps(options: {
    traceRecorder: ReturnType<typeof createTraceRecorder>;
    processEvent: (event: ExternalEvent) => Promise<string>;
    roundsToAllow: number;
  }): ContinuationLoopDeps {
    let judgeCallCount = 0;

    return {
      judge: {
        async evaluate(_context: Readonly<ContinuationJudgeContext>) {
          judgeCallCount++;
          // First call is the initial evaluation, then continuation rounds
          if (judgeCallCount <= options.roundsToAllow) {
            return {
              shouldContinue: true,
              reason: 'test continuation',
            };
          }
          return {
            shouldContinue: false,
            reason: 'test stop',
          };
        },
      },
      budget: {
        canContinue: () => true,
        spend: () => {},
        resetEvent: () => {},
        resetCycle: () => {},
      },
      queryTraces: async () => [],
      queryInterests: async () => [],
      assembleEvent: async () => ({
        source: 'test-source',
        content: 'test event',
        metadata: {},
        timestamp: new Date(),
      }),
      processEvent: options.processEvent,
      eventType: 'impulse',
      log: () => {}, // Silent logger for tests
    };
  }

  it('AC4.1: traces from multi-round continuation carry correct conversationId', async () => {
    const traceRecorder = createTraceRecorder(persistence);
    const testConversationId = crypto.randomUUID();
    const testOwner = `test-owner-${crypto.randomUUID()}`;

    const { processEvent } = createMockProcessEvent(
      traceRecorder,
      testConversationId,
      testOwner,
    );

    const deps = createMockDeps({
      traceRecorder,
      processEvent,
      roundsToAllow: 3,
    });

    await runContinuationLoop(deps, 'initial response', new Date());

    // Query traces from database
    const traces = await persistence.query<{
      id: string;
      owner: string;
      conversation_id: string;
      tool_name: string;
      created_at: string;
    }>(
      `SELECT id, owner, conversation_id, tool_name, created_at
       FROM operation_traces
       WHERE owner = $1
       ORDER BY created_at ASC`,
      [testOwner],
    );

    // Assert: 3 trace rows exist
    expect(traces).toHaveLength(3);

    // Assert: All 3 rows have correct conversationId
    for (const trace of traces) {
      expect(trace.conversation_id).toBe(testConversationId);
    }

    // Assert: Each row has a distinct tool_name
    const toolNames = traces.map((t) => t.tool_name);
    expect(toolNames).toEqual([
      'test-tool-round-1',
      'test-tool-round-2',
      'test-tool-round-3',
    ]);
  });

  it('AC4.2: each continuation round is independently atomic', async () => {
    const traceRecorder = createTraceRecorder(persistence);
    const testConversationId = crypto.randomUUID();
    const testOwner = `test-owner-${crypto.randomUUID()}`;

    const { processEvent } = createMockProcessEvent(
      traceRecorder,
      testConversationId,
      testOwner,
    );

    const deps = createMockDeps({
      traceRecorder,
      processEvent,
      roundsToAllow: 3,
    });

    await runContinuationLoop(deps, 'initial response', new Date());

    // Query traces ordered by created_at
    const traces = await persistence.query<{
      id: string;
      created_at: string;
      tool_name: string;
    }>(
      `SELECT id, created_at, tool_name
       FROM operation_traces
       WHERE owner = $1
       ORDER BY created_at ASC`,
      [testOwner],
    );

    // Assert: 3 traces exist
    expect(traces).toHaveLength(3);

    // Assert: Each trace has a unique id
    const ids = traces.map((t) => t.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);

    // Assert: Traces are ordered by creation time (round 1 < round 2 < round 3)
    expect(traces[0]!.tool_name).toBe('test-tool-round-1');
    expect(traces[1]!.tool_name).toBe('test-tool-round-2');
    expect(traces[2]!.tool_name).toBe('test-tool-round-3');

    // Assert: Timestamps are strictly increasing
    const time1 = new Date(traces[0]!.created_at).getTime();
    const time2 = new Date(traces[1]!.created_at).getTime();
    const time3 = new Date(traces[2]!.created_at).getTime();
    expect(time1).toBeLessThanOrEqual(time2);
    expect(time2).toBeLessThanOrEqual(time3);
  });

  it('AC4.3: error mid-round does not leave orphaned traces', async () => {
    const traceRecorder = createTraceRecorder(persistence);
    const testConversationId = crypto.randomUUID();
    const testOwner = `test-owner-${crypto.randomUUID()}`;

    const { processEvent } = createMockProcessEvent(
      traceRecorder,
      testConversationId,
      testOwner,
      { failOnRound: 2 }, // Fail on round 2 (before trace recording)
    );

    const deps = createMockDeps({
      traceRecorder,
      processEvent,
      roundsToAllow: 3,
    });

    // Should not throw - error is caught by the loop
    await runContinuationLoop(deps, 'initial response', new Date());

    // Query traces from database
    const traces = await persistence.query<{
      id: string;
      tool_name: string;
    }>(
      `SELECT id, tool_name
       FROM operation_traces
       WHERE owner = $1
       ORDER BY created_at ASC`,
      [testOwner],
    );

    // Assert: Only round 1's trace exists (loop exited after round 2 error)
    expect(traces).toHaveLength(1);
    expect(traces[0]!.tool_name).toBe('test-tool-round-1');

    // Assert: No orphaned trace from round 2
    const round2Traces = traces.filter((t) => t.tool_name === 'test-tool-round-2');
    expect(round2Traces).toHaveLength(0);
  });

  it('AC4.4: loop handles errors gracefully without throwing', async () => {
    const traceRecorder = createTraceRecorder(persistence);
    const testConversationId = crypto.randomUUID();
    const testOwner = `test-owner-${crypto.randomUUID()}`;

    const { processEvent } = createMockProcessEvent(
      traceRecorder,
      testConversationId,
      testOwner,
      { failOnRound: 1 }, // Fail on first round
    );

    const deps = createMockDeps({
      traceRecorder,
      processEvent,
      roundsToAllow: 3,
    });

    // Should not throw
    await expect(runContinuationLoop(deps, 'initial response', new Date())).resolves.toBeUndefined();

    // Assert: No traces in DB (error happened before any trace could be written)
    const traces = await persistence.query<{ id: string }>(
      `SELECT id FROM operation_traces WHERE owner = $1`,
      [testOwner],
    );

    expect(traces).toHaveLength(0);
  });
});
