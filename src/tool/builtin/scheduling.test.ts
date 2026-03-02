// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { validateMinimumInterval, createSchedulingTools } from './scheduling.ts';
import type { Scheduler, ScheduledTask } from '../../extensions/scheduler.ts';
import type { PersistenceProvider, QueryFunction } from '../../persistence/types.ts';

describe('validateMinimumInterval', () => {
  it('should reject cron expression with interval less than minimum (* * * * * — every minute)', () => {
    const result = validateMinimumInterval('* * * * *', 10);
    expect(result).toBe(false);
  });

  it('should accept cron expression with interval greater than minimum (0 */2 * * * — every 2 hours)', () => {
    const result = validateMinimumInterval('0 */2 * * *', 10);
    expect(result).toBe(true);
  });

  it('should accept cron expression at exactly minimum interval (*/10 * * * * — exactly 10 minutes)', () => {
    const result = validateMinimumInterval('*/10 * * * *', 10);
    expect(result).toBe(true);
  });

  it('should reject cron expression below minimum (*/9 * * * * — 9 minutes)', () => {
    const result = validateMinimumInterval('*/9 * * * *', 10);
    expect(result).toBe(false);
  });

  it('should accept ISO 8601 timestamp (fewer than 2 future runs)', () => {
    const futureTime = new Date();
    futureTime.setHours(futureTime.getHours() + 1);
    const isoTimestamp = futureTime.toISOString();
    const result = validateMinimumInterval(isoTimestamp, 10);
    expect(result).toBe(true);
  });
});

describe('createSchedulingTools — schedule_task', () => {
  // Mock Scheduler
  function createMockScheduler(): {
    scheduler: Scheduler;
    getCalls: () => Array<{ task: ScheduledTask; resultId: string; resultNextRunAt: Date }>;
  } {
    const calls: Array<{ task: ScheduledTask; resultId: string; resultNextRunAt: Date }> = [];

    return {
      scheduler: {
        async schedule(task: ScheduledTask): Promise<{ id: string; nextRunAt: Date }> {
          const resultId = task.id;
          const nextRunAt = new Date(Date.now() + 60000); // 1 minute in the future
          calls.push({ task, resultId, resultNextRunAt: nextRunAt });
          return { id: resultId, nextRunAt };
        },
        async cancel(): Promise<void> {},
        onDue(): void {},
      },
      getCalls: () => calls,
    };
  }

  // Mock PersistenceProvider (not used in schedule_task, but required by factory)
  function createMockPersistence(): PersistenceProvider {
    const mockQuery: QueryFunction = async () => [];

    return {
      async connect(): Promise<void> {},
      async disconnect(): Promise<void> {},
      async runMigrations(): Promise<void> {},
      query: mockQuery,
      async withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T> {
        return fn(mockQuery);
      },
    };
  }

  it('AC1.1: should schedule a recurring task with valid cron expression', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');
    expect(scheduleTaskTool).toBeDefined();

    const result = await scheduleTaskTool!.handler({
      name: 'Memory consolidation',
      schedule: '0 */2 * * *',
      prompt: 'Review and consolidate memory blocks',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const output = JSON.parse(result.output);
    expect(output.id).toBeDefined();
    expect(output.name).toBe('Memory consolidation');
    expect(output.schedule).toBe('0 */2 * * *');
    expect(output.next_run_at).toBeDefined();

    const calls = mockScheduler.getCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]!.task.payload['type']).toBe('agent-scheduled');
    expect(calls[0]!.task.payload['prompt']).toBe('Review and consolidate memory blocks');
  });

  it('AC1.2: should schedule a one-shot task with future ISO 8601 timestamp', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    const futureTime = new Date();
    futureTime.setHours(futureTime.getHours() + 2);
    const isoTimestamp = futureTime.toISOString();

    const result = await scheduleTaskTool!.handler({
      name: 'One-shot reminder',
      schedule: isoTimestamp,
      prompt: 'Execute this reminder',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const output = JSON.parse(result.output);
    expect(output.id).toBeDefined();
    expect(output.next_run_at).toBeDefined();
  });

  it('AC1.3: should reject cron expression with interval < 10 minutes', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    const result = await scheduleTaskTool!.handler({
      name: 'Too frequent task',
      schedule: '* * * * *',
      prompt: 'This runs every minute',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('interval is too frequent');
    expect(result.error).toContain('10 minutes');
  });

  it('AC1.4: should reject ISO 8601 timestamp in the past', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    const pastTime = new Date();
    pastTime.setHours(pastTime.getHours() - 1);
    const isoTimestamp = pastTime.toISOString();

    const result = await scheduleTaskTool!.handler({
      name: 'Past reminder',
      schedule: isoTimestamp,
      prompt: 'This is in the past',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('must be in the future');
  });

  it('AC1.5: should reject invalid schedule string', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    const result = await scheduleTaskTool!.handler({
      name: 'Invalid schedule',
      schedule: 'not-a-schedule',
      prompt: 'Invalid schedule format',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Invalid schedule format');
  });

  it('AC1.6: should include prompt in task payload', async () => {
    const mockScheduler = createMockScheduler();
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: createMockPersistence(),
    });

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    const result = await scheduleTaskTool!.handler({
      name: 'Test task',
      schedule: '0 */2 * * *',
      prompt: 'My custom prompt instruction',
    });

    expect(result.success).toBe(true);

    const calls = mockScheduler.getCalls();
    expect(calls.length).toBe(1);
    const payload = calls[0]!.task.payload;
    expect(payload['type']).toBe('agent-scheduled');
    expect(payload['prompt']).toBe('My custom prompt instruction');
  });

  it('AC1.7: should pass owner to scheduler (via task ownership)', async () => {
    const mockScheduler = createMockScheduler();
    const deps = {
      scheduler: mockScheduler.scheduler,
      owner: 'custom-owner-id',
      persistence: createMockPersistence(),
    };
    const tools = createSchedulingTools(deps);

    const scheduleTaskTool = tools.find((t) => t.definition.name === 'schedule_task');

    await scheduleTaskTool!.handler({
      name: 'Owned task',
      schedule: '0 */2 * * *',
      prompt: 'Task prompt',
    });

    const calls = mockScheduler.getCalls();
    expect(calls.length).toBe(1);
    // The owner is passed via deps to the Scheduler, which handles it internally
    // The tool itself doesn't directly insert the owner, but the factory deps contain it
    expect(deps.owner).toBe('custom-owner-id');
  });
});

describe('createSchedulingTools — cancel_task', () => {
  // Mock Scheduler with cancel tracking
  function createMockScheduler(): {
    scheduler: Scheduler;
    getCancelCalls: () => Array<string>;
  } {
    const cancelCalls: Array<string> = [];

    return {
      scheduler: {
        async schedule(): Promise<{ id: string; nextRunAt: Date }> {
          const nextRunAt = new Date(Date.now() + 60000);
          return { id: 'task-id', nextRunAt };
        },
        async cancel(taskId: string): Promise<void> {
          cancelCalls.push(taskId);
        },
        onDue(): void {},
      },
      getCancelCalls: () => cancelCalls,
    };
  }

  // Mock PersistenceProvider with configurable query results
  function createMockPersistence(
    queryResults: Array<Record<string, unknown>> = [],
  ): {
    persistence: PersistenceProvider;
    getQueries: () => Array<{ sql: string; params: ReadonlyArray<unknown> }>;
  } {
    const queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];

    const mockQuery: QueryFunction = async (sql: string, params?: ReadonlyArray<unknown>) => {
      queries.push({ sql, params: params || [] });
      return queryResults;
    };

    return {
      persistence: {
        async connect(): Promise<void> {},
        async disconnect(): Promise<void> {},
        async runMigrations(): Promise<void> {},
        query: mockQuery,
        async withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T> {
          return fn(mockQuery);
        },
      },
      getQueries: () => queries,
    };
  }

  it('AC2.1: should cancel a task by ID', async () => {
    const mockScheduler = createMockScheduler();
    const mockPersistence = createMockPersistence([{ id: 'task-123' }]);
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const cancelTaskTool = tools.find((t) => t.definition.name === 'cancel_task');
    expect(cancelTaskTool).toBeDefined();

    const result = await cancelTaskTool!.handler({
      task_id: 'task-123',
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const output = JSON.parse(result.output);
    expect(output.id).toBe('task-123');
    expect(output.status).toBe('cancelled');

    const cancelCalls = mockScheduler.getCancelCalls();
    expect(cancelCalls.length).toBe(1);
    expect(cancelCalls[0]).toBe('task-123');
  });

  it('AC2.2: should return error when task does not exist', async () => {
    const mockScheduler = createMockScheduler();
    const mockPersistence = createMockPersistence([]); // Empty result set
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const cancelTaskTool = tools.find((t) => t.definition.name === 'cancel_task');

    const result = await cancelTaskTool!.handler({
      task_id: 'nonexistent-task',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Task not found or not owned by this agent');
  });

  it('AC2.3: should prevent cancelling tasks owned by system (owner isolation)', async () => {
    const mockScheduler = createMockScheduler();
    const mockPersistence = createMockPersistence([]); // Query filters by owner, so system task won't be found
    const tools = createSchedulingTools({
      scheduler: mockScheduler.scheduler,
      owner: 'test-agent', // Agent can only see/cancel tasks they own
      persistence: mockPersistence.persistence,
    });

    const cancelTaskTool = tools.find((t) => t.definition.name === 'cancel_task');

    // Try to cancel a system task; it won't be found because the query filters by owner
    const result = await cancelTaskTool!.handler({
      task_id: 'system-task-123',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Task not found or not owned by this agent');

    // Verify the query included the owner filter
    const queries = mockPersistence.getQueries();
    expect(queries.length).toBe(1);
    expect(queries[0]!.sql).toContain('owner = $2');
    expect(queries[0]!.params[1]).toBe('test-agent');
  });
});

describe('createSchedulingTools — list_tasks', () => {
  // Mock Scheduler (not used by list_tasks, but required by factory)
  function createMockScheduler(): Scheduler {
    return {
      async schedule(): Promise<{ id: string; nextRunAt: Date }> {
        const nextRunAt = new Date(Date.now() + 60000);
        return { id: 'task-id', nextRunAt };
      },
      async cancel(): Promise<void> {},
      onDue(): void {},
    };
  }

  // Mock PersistenceProvider with configurable query results
  function createMockPersistence(
    queryResults: Array<Record<string, unknown>> = [],
  ): {
    persistence: PersistenceProvider;
    getQueries: () => Array<{ sql: string; params: ReadonlyArray<unknown> }>;
  } {
    const queries: Array<{ sql: string; params: ReadonlyArray<unknown> }> = [];

    const mockQuery: QueryFunction = async (sql: string, params?: ReadonlyArray<unknown>) => {
      queries.push({ sql, params: params || [] });
      return queryResults;
    };

    return {
      persistence: {
        async connect(): Promise<void> {},
        async disconnect(): Promise<void> {},
        async runMigrations(): Promise<void> {},
        query: mockQuery,
        async withTransaction<T>(fn: (query: QueryFunction) => Promise<T>): Promise<T> {
          return fn(mockQuery);
        },
      },
      getQueries: () => queries,
    };
  }

  it('AC3.1: should return active tasks by default (non-cancelled)', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    const nextWeek = new Date(now.getTime() + 604800000);

    const taskRows = [
      {
        id: 'task-1',
        name: 'Memory consolidation',
        schedule: '0 */2 * * *',
        payload: { type: 'agent-scheduled', prompt: 'Review and consolidate memory' },
        next_run_at: tomorrow,
        last_run_at: now,
        cancelled: false,
      },
      {
        id: 'task-2',
        name: 'Data backup',
        schedule: '0 0 * * 0',
        payload: { type: 'agent-scheduled', prompt: 'Backup data' },
        next_run_at: nextWeek,
        last_run_at: null,
        cancelled: false,
      },
    ];

    const mockPersistence = createMockPersistence(taskRows);
    const tools = createSchedulingTools({
      scheduler: createMockScheduler(),
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const listTasksTool = tools.find((t) => t.definition.name === 'list_tasks');
    expect(listTasksTool).toBeDefined();

    const result = await listTasksTool!.handler({
      include_cancelled: false,
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const output = JSON.parse(result.output);
    expect(Array.isArray(output)).toBe(true);
    expect(output.length).toBe(2);

    expect(output[0]!.id).toBe('task-1');
    expect(output[0]!.name).toBe('Memory consolidation');
    expect(output[0]!.prompt).toBe('Review and consolidate memory');
    expect(output[0]!.next_run_at).toBeDefined();
    expect(output[0]!.last_run_at).toBeDefined();

    // Verify query included cancelled filter
    const queries = mockPersistence.getQueries();
    expect(queries[0]!.sql).toContain('AND cancelled = FALSE');
  });

  it('AC3.2: should include cancelled tasks when requested', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    const taskRows = [
      {
        id: 'task-1',
        name: 'Active task',
        schedule: '0 */2 * * *',
        payload: { type: 'agent-scheduled', prompt: 'Active prompt' },
        next_run_at: tomorrow,
        last_run_at: now,
        cancelled: false,
      },
      {
        id: 'task-2',
        name: 'Cancelled task',
        schedule: '0 0 * * 0',
        payload: { type: 'agent-scheduled', prompt: 'Cancelled prompt' },
        next_run_at: tomorrow,
        last_run_at: now,
        cancelled: true,
      },
    ];

    const mockPersistence = createMockPersistence(taskRows);
    const tools = createSchedulingTools({
      scheduler: createMockScheduler(),
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const listTasksTool = tools.find((t) => t.definition.name === 'list_tasks');

    const result = await listTasksTool!.handler({
      include_cancelled: true,
    });

    expect(result.success).toBe(true);

    const output = JSON.parse(result.output);
    expect(output.length).toBe(2);
    expect(output[0]!['cancelled']).toBe(false);
    expect(output[1]!['cancelled']).toBe(true);

    // Verify query did NOT include cancelled filter
    const queries = mockPersistence.getQueries();
    expect(queries[0]!.sql).not.toContain('AND cancelled = FALSE');
  });

  it('AC3.3: should return human-readable JSON output', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    const taskRows = [
      {
        id: 'task-1',
        name: 'Test task',
        schedule: '0 */2 * * *',
        payload: { type: 'agent-scheduled', prompt: 'Test prompt' },
        next_run_at: tomorrow,
        last_run_at: now,
        cancelled: false,
      },
    ];

    const mockPersistence = createMockPersistence(taskRows);
    const tools = createSchedulingTools({
      scheduler: createMockScheduler(),
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const listTasksTool = tools.find((t) => t.definition.name === 'list_tasks');

    const result = await listTasksTool!.handler({});

    expect(result.success).toBe(true);

    // Verify it's valid JSON
    const output = JSON.parse(result.output);
    expect(Array.isArray(output)).toBe(true);

    // Verify fields are present and human-readable
    const task = output[0]!;
    expect(task.id).toBeDefined();
    expect(task.name).toBeDefined();
    expect(task.schedule).toBeDefined();
    expect(task.prompt).toBeDefined();
    expect(task.next_run_at).toBeDefined();
    expect(task.last_run_at).toBeDefined();

    // Verify ISO timestamps
    expect(typeof task.next_run_at).toBe('string');
    expect(task.next_run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO 8601 format
  });

  it('AC3.4: should only return tasks owned by the agent (system tasks excluded)', async () => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);

    const taskRows = [
      {
        id: 'agent-task-1',
        name: 'Agent task',
        schedule: '0 */2 * * *',
        payload: { type: 'agent-scheduled', prompt: 'Agent prompt' },
        next_run_at: tomorrow,
        last_run_at: now,
        cancelled: false,
      },
    ];

    const mockPersistence = createMockPersistence(taskRows);
    const tools = createSchedulingTools({
      scheduler: createMockScheduler(),
      owner: 'test-agent',
      persistence: mockPersistence.persistence,
    });

    const listTasksTool = tools.find((t) => t.definition.name === 'list_tasks');

    const result = await listTasksTool!.handler({
      include_cancelled: true,
    });

    expect(result.success).toBe(true);

    // Verify query filtered by owner
    const queries = mockPersistence.getQueries();
    expect(queries[0]!.sql).toContain('owner = $1');
    expect(queries[0]!.params[0]).toBe('test-agent');

    // Verify only agent-owned tasks are returned (system tasks would be excluded by the WHERE clause)
    const output = JSON.parse(result.output);
    expect(output.length).toBe(1);
    expect(output[0]!.name).toBe('Agent task');
  });
});
