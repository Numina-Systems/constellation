// pattern: Imperative Shell

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import { createPostgresProvider } from '../persistence/postgres.ts';
import { createTraceRecorder } from './trace-recorder.ts';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let recorder: ReturnType<typeof createTraceRecorder>;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE operation_traces CASCADE');
}

describe('TraceRecorder', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    recorder = createTraceRecorder(persistence);
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC2.1: Record trace with all fields', () => {
    it('records a trace with all fields populated', async () => {
      const trace = {
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'memory_read',
        input: { query: 'test' },
        outputSummary: 'Found 3 results',
        durationMs: 150,
        success: true,
        error: null,
      };

      await recorder.record(trace);

      const traces = await recorder.queryTraces({ owner: TEST_OWNER });
      expect(traces).toHaveLength(1);
      expect(traces[0]?.toolName).toBe('memory_read');
      expect(traces[0]?.outputSummary).toBe('Found 3 results');
      expect(traces[0]?.durationMs).toBe(150);
      expect(traces[0]?.success).toBe(true);
      expect(traces[0]?.error).toBeNull();
    });
  });

  describe('AC2.2: Record trace with error', () => {
    it('records a trace with success=false and error message', async () => {
      const trace = {
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'web_search',
        input: { query: 'test' },
        outputSummary: 'Network timeout',
        durationMs: 5000,
        success: false,
        error: 'Connection timeout after 5s',
      };

      await recorder.record(trace);

      const traces = await recorder.queryTraces({ owner: TEST_OWNER });
      expect(traces).toHaveLength(1);
      expect(traces[0]?.success).toBe(false);
      expect(traces[0]?.error).toBe('Connection timeout after 5s');
    });
  });

  describe('AC2.3: Output summary truncation', () => {
    it('truncates outputSummary to 500 characters', async () => {
      const longOutput = 'x'.repeat(1000);
      const trace = {
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'test_tool',
        input: {},
        outputSummary: longOutput,
        durationMs: 100,
        success: true,
        error: null,
      };

      await recorder.record(trace);

      const traces = await recorder.queryTraces({ owner: TEST_OWNER });
      expect(traces).toHaveLength(1);
      expect(traces[0]?.outputSummary).toHaveLength(500);
      expect(traces[0]?.outputSummary).toBe('x'.repeat(500));
    });
  });

  describe('AC2.4: Fire-and-forget recording', () => {
    it('does not throw on record failure, logs warning instead', async () => {
      // Disconnect to cause INSERT failure
      await persistence.disconnect();

      const trace = {
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'test_tool',
        input: {},
        outputSummary: 'Test',
        durationMs: 100,
        success: true,
        error: null,
      };

      // This should not throw despite persistence being disconnected
      let threwError = false;
      try {
        await recorder.record(trace);
      } catch {
        threwError = true;
      }

      expect(threwError).toBe(false);

      // Reconnect for cleanup
      await persistence.connect();
    });
  });

  describe('queryTraces filtering', () => {
    it('filters by owner', async () => {
      const owner1 = 'owner-' + Math.random().toString(36).substring(7);
      const owner2 = 'owner-' + Math.random().toString(36).substring(7);

      await recorder.record({
        owner: owner1,
        conversationId: 'conv-1',
        toolName: 'test_tool',
        input: {},
        outputSummary: 'Owner 1 trace',
        durationMs: 100,
        success: true,
        error: null,
      });

      await recorder.record({
        owner: owner2,
        conversationId: 'conv-2',
        toolName: 'test_tool',
        input: {},
        outputSummary: 'Owner 2 trace',
        durationMs: 100,
        success: true,
        error: null,
      });

      const traces1 = await recorder.queryTraces({ owner: owner1 });
      const traces2 = await recorder.queryTraces({ owner: owner2 });

      expect(traces1).toHaveLength(1);
      expect(traces2).toHaveLength(1);
      expect(traces1[0]?.outputSummary).toBe('Owner 1 trace');
      expect(traces2[0]?.outputSummary).toBe('Owner 2 trace');
    });

    it('filters by toolName', async () => {
      await recorder.record({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'memory_read',
        input: {},
        outputSummary: 'Memory trace',
        durationMs: 100,
        success: true,
        error: null,
      });

      await recorder.record({
        owner: TEST_OWNER,
        conversationId: 'conv-2',
        toolName: 'web_search',
        input: {},
        outputSummary: 'Search trace',
        durationMs: 200,
        success: true,
        error: null,
      });

      const memoryTraces = await recorder.queryTraces({
        owner: TEST_OWNER,
        toolName: 'memory_read',
      });
      const searchTraces = await recorder.queryTraces({
        owner: TEST_OWNER,
        toolName: 'web_search',
      });

      expect(memoryTraces).toHaveLength(1);
      expect(memoryTraces[0]?.toolName).toBe('memory_read');
      expect(searchTraces).toHaveLength(1);
      expect(searchTraces[0]?.toolName).toBe('web_search');
    });

    it('filters by successOnly flag', async () => {
      await recorder.record({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'tool1',
        input: {},
        outputSummary: 'Success',
        durationMs: 100,
        success: true,
        error: null,
      });

      await recorder.record({
        owner: TEST_OWNER,
        conversationId: 'conv-2',
        toolName: 'tool2',
        input: {},
        outputSummary: 'Failure',
        durationMs: 100,
        success: false,
        error: 'Error message',
      });

      const allTraces = await recorder.queryTraces({ owner: TEST_OWNER });
      const successOnly = await recorder.queryTraces({
        owner: TEST_OWNER,
        successOnly: true,
      });

      expect(allTraces).toHaveLength(2);
      expect(successOnly).toHaveLength(1);
      expect(successOnly[0]?.success).toBe(true);
    });

    it('respects limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await recorder.record({
          owner: TEST_OWNER,
          conversationId: `conv-${i}`,
          toolName: 'tool',
          input: {},
          outputSummary: `Trace ${i}`,
          durationMs: 100,
          success: true,
          error: null,
        });
      }

      const allTraces = await recorder.queryTraces({ owner: TEST_OWNER });
      const limited = await recorder.queryTraces({ owner: TEST_OWNER, limit: 2 });

      expect(allTraces).toHaveLength(5);
      expect(limited).toHaveLength(2);
    });

    it('filters by lookbackSince', async () => {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

      // Record a trace
      await recorder.record({
        owner: TEST_OWNER,
        conversationId: 'conv-1',
        toolName: 'tool1',
        input: {},
        outputSummary: 'Recent trace',
        durationMs: 100,
        success: true,
        error: null,
      });

      // Query with lookback to 1 hour ago - should find the trace
      const recentTraces = await recorder.queryTraces({
        owner: TEST_OWNER,
        lookbackSince: oneHourAgo,
      });

      expect(recentTraces).toHaveLength(1);

      // Query with lookback to 1 second ago - should not find the trace
      const futureTraces = await recorder.queryTraces({
        owner: TEST_OWNER,
        lookbackSince: new Date(now.getTime() + 1000),
      });

      expect(futureTraces).toHaveLength(0);
    });

    it('orders results by created_at DESC', async () => {
      for (let i = 0; i < 3; i++) {
        await recorder.record({
          owner: TEST_OWNER,
          conversationId: `conv-${i}`,
          toolName: 'tool',
          input: {},
          outputSummary: `Trace ${i}`,
          durationMs: 100,
          success: true,
          error: null,
        });
        // Small delay to ensure different timestamps
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const traces = await recorder.queryTraces({ owner: TEST_OWNER });

      expect(traces).toHaveLength(3);
      // Should be in reverse chronological order
      expect(traces[0]?.outputSummary).toBe('Trace 2');
      expect(traces[1]?.outputSummary).toBe('Trace 1');
      expect(traces[2]?.outputSummary).toBe('Trace 0');
    });
  });
});
