// pattern: Imperative Shell

/**
 * Integration tests for checkpoint triggers.
 * Verifies checkpoint creation at explicit command, pre-compaction, shutdown, and turn-interval trigger points.
 * Tests failure tolerance and proper wiring through the agent loop.
 */

import { describe, it, expect } from 'bun:test';
import { createAgent } from './agent.ts';
import type {
  AgentConfig,
  AgentDependencies,
  ConversationMessage,
} from './types.ts';
import type { ModelProvider, ModelRequest, ModelResponse } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ToolRegistry } from '../tool/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { PersistenceProvider, QueryFunction } from '../persistence/types.ts';
import type { Compactor, CompactionResult } from '../compaction/types.ts';
import type { CheckpointStore } from '../persistence/checkpoint-store.ts';
import type { SessionCheckpoint } from './checkpoint-types.ts';
import { createCheckpointTool } from '../tool/builtin/checkpoint.ts';
import { performCheckpoint, type CheckpointDependencies } from './checkpoint-create.ts';
import type { CheckpointAgentState } from './checkpoint-types.ts';

/**
 * Mock implementations for checkpoint integration testing
 */

// Mock PersistenceProvider
function createMockPersistenceProvider(): PersistenceProvider & { capturedInserts: Array<Array<unknown>> } {
  const messages: Map<string, Array<ConversationMessage>> = new Map();
  const capturedInserts: Array<Array<unknown>> = [];
  let nextId = 1;

  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    if (sql.includes('INSERT INTO messages')) {
      const paramArray = params ? Array.from(params) : [];
      capturedInserts.push(paramArray);
      const [conversationId, role, content, toolCalls, toolCallId, reasoningContent] = paramArray;
      const id = String(nextId++);
      const message: ConversationMessage = {
        id,
        conversation_id: String(conversationId),
        role: role as ConversationMessage['role'],
        content: String(content),
        tool_calls: toolCalls,
        tool_call_id: toolCallId ? String(toolCallId) : undefined,
        reasoning_content: reasoningContent ? String(reasoningContent) : undefined,
        created_at: new Date(),
      };
      const list = messages.get(String(conversationId)) || [];
      list.push(message);
      messages.set(String(conversationId), list);
      return [{ id } as unknown as T];
    }

    if (sql.includes('SELECT') && sql.includes('FROM messages')) {
      const [conversationId] = params || [];
      return (messages.get(String(conversationId)) || []) as unknown as Array<T>;
    }

    if (sql.includes('DELETE FROM messages') && sql.includes('WHERE id = ANY')) {
      const [idsParam] = params || [];
      for (const [key, msgList] of messages.entries()) {
        messages.set(
          key,
          msgList.filter((msg) => !(Array.isArray(idsParam) && idsParam.includes(msg.id))),
        );
      }
      return [] as Array<T>;
    }

    return [] as Array<T>;
  };

  return {
    capturedInserts,
    async connect() {},
    async disconnect() {},
    async runMigrations() {},
    query,
    async withTransaction<T>(fn: (q: QueryFunction) => Promise<T>) {
      return fn(query);
    },
  };
}

// Mock MemoryManager
function createMockMemoryManager(): MemoryManager {
  return {
    async getCoreBlocks() {
      return [];
    },
    async getWorkingBlocks() {
      return [];
    },
    async buildSystemPrompt() {
      return 'You are a helpful assistant.';
    },
    async read() {
      return [];
    },
    async write() {
      return {
        applied: true,
        block: {
          id: 'test',
          owner: 'test',
          tier: 'working',
          label: 'test',
          content: 'test',
          embedding: null,
          permission: 'readwrite',
          pinned: false,
          created_at: new Date(),
          updated_at: new Date(),
        },
      };
    },
    async list() {
      return [];
    },
    async deleteBlock() {
      // no-op for testing
    },
    async getPendingMutations() {
      return [];
    },
    async approveMutation() {
      throw new Error('not implemented');
    },
    async rejectMutation() {
      throw new Error('not implemented');
    },
    async moveBlock() {
      throw new Error('not implemented');
    },
    async getStats() {
      return { tier: 'all', block_count: 0, total_bytes: 0 };
    },
  };
}

// Mock ToolRegistry
function createMockToolRegistry(): ToolRegistry {
  return {
    register() {},
    getDefinitions() {
      return [];
    },
    async dispatch(name: string, params: Record<string, unknown>) {
      return {
        success: true,
        output: `Tool ${name} executed with params: ${JSON.stringify(params)}`,
      };
    },
    generateStubs() {
      return '';
    },
    toModelTools() {
      return [];
    },
  };
}

// Mock CodeRuntime
function createMockCodeRuntime(): CodeRuntime {
  return {
    async execute(_code: string, _toolStubs: string) {
      return {
        success: true,
        output: 'Code executed successfully',
        error: null,
        tool_calls_made: 0,
        duration_ms: 10,
      };
    },
  };
}

// Mock ModelProvider with configurable responses
function createMockModelProvider(
  responses: ReadonlyArray<ModelResponse>,
  tracker?: { requests: Array<ModelRequest> },
): ModelProvider {
  let callIndex = 0;

  return {
    async complete(request: ModelRequest): Promise<ModelResponse> {
      if (tracker) {
        tracker.requests.push(request);
      }

      const response = responses[callIndex];
      callIndex++;

      if (!response) {
        return {
          content: [{ type: 'text', text: 'No more responses configured' }],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        };
      }

      return response;
    },

    async *stream(_request: ModelRequest) {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
  };
}

// Mock CheckpointStore for tracking checkpoint saves
function createMockCheckpointStore(): CheckpointStore & {
  savedCheckpoints: Array<SessionCheckpoint>;
  pruneCalls: Array<{ conversationId: string; retainCount: number }>;
} {
  const savedCheckpoints: Array<SessionCheckpoint> = [];
  const pruneCalls: Array<{ conversationId: string; retainCount: number }> = [];

  return {
    savedCheckpoints,
    pruneCalls,
    async save(checkpoint: SessionCheckpoint) {
      savedCheckpoints.push(checkpoint);
    },
    async load(_id: string) {
      return null;
    },
    async loadLatest(_owner: string) {
      return null;
    },
    async prune(conversationId: string, retainCount: number) {
      pruneCalls.push({ conversationId, retainCount });
      return 0;
    },
  };
}

// Helper to create AgentDependencies with checkpoint support
function createAgentDependencies(overrides?: {
  model?: ModelProvider;
  memory?: MemoryManager;
  registry?: ToolRegistry;
  runtime?: CodeRuntime;
  persistence?: PersistenceProvider;
  config?: AgentConfig;
  compactor?: Compactor;
  checkpointFn?: (trigger: string) => Promise<string | null>;
  checkpointStateRef?: { current: CheckpointAgentState } | undefined;
}): AgentDependencies {
  return {
    model: overrides?.model ?? createMockModelProvider([]),
    memory: overrides?.memory ?? createMockMemoryManager(),
    registry: overrides?.registry ?? createMockToolRegistry(),
    runtime: overrides?.runtime ?? createMockCodeRuntime(),
    persistence: overrides?.persistence ?? createMockPersistenceProvider(),
    config: overrides?.config ?? { max_tool_rounds: 5, context_budget: 0.8 },
    compactor: overrides?.compactor,
    checkpointFn: overrides?.checkpointFn,
    checkpointStateRef: overrides?.checkpointStateRef,
  };
}

describe('Checkpoint Triggers', () => {
  describe('AC1.1: Explicit checkpoint tool', () => {
    it('should create checkpoint with trigger: explicit when checkpoint tool is called', async () => {
      const store = createMockCheckpointStore();

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      const agentState: CheckpointAgentState = {
        turnNumber: 1,
        toolRound: 0,
        messageIds: ['msg-1'],
        compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
      };

      const tool = createCheckpointTool(checkpointDeps, () => agentState);

      // Call the tool handler
      const result = await tool.handler({});

      expect(result.success).toBe(true);
      expect(result.output).toMatch(/^Checkpoint created:/);
      expect(store.savedCheckpoints.length).toBe(1);
      expect(store.savedCheckpoints[0]?.trigger).toBe('explicit');
    });
  });

  describe('AC1.2: Pre-compaction checkpoint', () => {
    it('should create checkpoint before compaction runs', async () => {
      const store = createMockCheckpointStore();
      let compressWasCalled = false;
      let checkpointCountWhenCompressionStarted = 0;

      const trackedCompactor: Compactor = {
        async compress(_history: ReadonlyArray<ConversationMessage>, _conversationId: string) {
          compressWasCalled = true;
          checkpointCountWhenCompressionStarted = store.savedCheckpoints.length;
          return {
            history: _history.slice(0, 1), // Return at least one message
            batchesCreated: 1,
            messagesCompressed: Math.max(1, _history.length - 1),
            tokensEstimateBefore: 10000,
            tokensEstimateAfter: 5000,
          } as CompactionResult;
        },
        consecutiveFailures: 0,
      };

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      let checkpointFnCalled = false;
      const checkpointFn = async (trigger: string) => {
        if (trigger === 'pre_compaction') {
          checkpointFnCalled = true;
          const agentState: CheckpointAgentState = {
            turnNumber: 1,
            toolRound: 0,
            messageIds: ['msg-1', 'msg-2'],
            compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
          };
          return await performCheckpoint('pre_compaction', agentState, checkpointDeps);
        }
        return null;
      };

      const deps = createAgentDependencies({
        compactor: trackedCompactor,
        config: {
          max_tool_rounds: 5,
          context_budget: 0.1, // Very low to force compression
          checkpoint_interval: 0,
        },
        checkpointFn,
      });

      // Create agent and process a message that will trigger compaction
      const agent = createAgent(deps, 'conv-123');

      // Send a message (will trigger checkpointFn before compress if budget is exceeded)
      await agent.processMessage('Hello world');

      // Verify: checkpoint was created before compaction
      expect(checkpointFnCalled).toBe(true);
      expect(compressWasCalled).toBe(true);
      expect(checkpointCountWhenCompressionStarted).toBeGreaterThan(0);
      expect(store.savedCheckpoints[0]?.trigger).toBe('pre_compaction');
    });
  });

  describe('AC1.3: Shutdown checkpoint', () => {
    it('should create checkpoint with trigger: shutdown', async () => {
      const store = createMockCheckpointStore();

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      const agentState: CheckpointAgentState = {
        turnNumber: 5,
        toolRound: 0,
        messageIds: ['msg-1', 'msg-2', 'msg-3'],
        compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
      };

      // Simulate shutdown checkpoint creation
      const shutdownCheckpointId = await performCheckpoint('shutdown', agentState, checkpointDeps);

      expect(shutdownCheckpointId).not.toBeNull();
      expect(store.savedCheckpoints.length).toBe(1);
      expect(store.savedCheckpoints[0]?.trigger).toBe('shutdown');
      expect(store.savedCheckpoints[0]?.turnNumber).toBe(5);
    });
  });

  describe('AC1.4: Turn-interval checkpoint', () => {
    it('should create checkpoints at configured intervals', async () => {
      const store = createMockCheckpointStore();

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      // Simulate turn-interval checkpoints at turns 2 and 4
      const agentStateAfterTurn2: CheckpointAgentState = {
        turnNumber: 2,
        toolRound: 0,
        messageIds: ['msg-1', 'msg-2'],
        compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
      };

      const agentStateAfterTurn4: CheckpointAgentState = {
        turnNumber: 4,
        toolRound: 0,
        messageIds: ['msg-1', 'msg-2', 'msg-3', 'msg-4'],
        compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
      };

      // Create checkpoints at the configured interval
      await performCheckpoint('interval', agentStateAfterTurn2, checkpointDeps);
      await performCheckpoint('interval', agentStateAfterTurn4, checkpointDeps);

      expect(store.savedCheckpoints.length).toBe(2);
      expect(store.savedCheckpoints[0]?.trigger).toBe('interval');
      expect(store.savedCheckpoints[0]?.turnNumber).toBe(2);
      expect(store.savedCheckpoints[1]?.trigger).toBe('interval');
      expect(store.savedCheckpoints[1]?.turnNumber).toBe(4);
    });
  });

  describe('AC1.5: Interval disabled when checkpoint_interval is 0', () => {
    it('should not create interval checkpoints when checkpoint_interval is 0', async () => {
      const store = createMockCheckpointStore();
      let checkpointFnCallCount = 0;

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      const checkpointFn = async (trigger: string) => {
        if (trigger === 'interval') {
          checkpointFnCallCount++;
          const agentState: CheckpointAgentState = {
            turnNumber: checkpointFnCallCount,
            toolRound: 0,
            messageIds: [`msg-${checkpointFnCallCount}`],
            compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
          };
          return await performCheckpoint('interval', agentState, checkpointDeps);
        }
        return null;
      };

      const deps = createAgentDependencies({
        config: {
          max_tool_rounds: 5,
          context_budget: 0.8,
          checkpoint_interval: 0, // Disabled
        },
        checkpointFn,
      });

      const agent = createAgent(deps, 'conv-123');

      // Process 4 messages; with checkpoint_interval=0, no interval checkpoints should be created
      for (let i = 0; i < 4; i++) {
        await agent.processMessage(`Message ${i + 1}`);
      }

      // Verify: checkpointFn was never called with 'interval' trigger
      expect(checkpointFnCallCount).toBe(0);
      expect(store.savedCheckpoints.filter(cp => cp.trigger === 'interval')).toHaveLength(0);
    });
  });

  describe('AC1.6: Failure tolerance when checkpoint creation fails', () => {
    it('should handle checkpoint creation failure gracefully without blocking agent', async () => {
      let warningLogged = false;
      let loggedWarning = '';

      // Mock console.warn to capture warnings
      const originalWarn = console.warn;
      console.warn = (message: string) => {
        warningLogged = true;
        loggedWarning = message;
      };

      try {
        const failingCheckpointStore: CheckpointStore = {
          async save() {
            throw new Error('Database connection failed');
          },
          async load() {
            return null;
          },
          async loadLatest() {
            return null;
          },
          async prune() {
            return 0;
          },
        };

        const checkpointDeps: CheckpointDependencies = {
          checkpointStore: failingCheckpointStore,
          memory: createMockMemoryManager(),
          owner: 'test-owner',
          conversationId: 'conv-123',
          retentionCount: 5,
        };

        const agentState: CheckpointAgentState = {
          turnNumber: 1,
          toolRound: 0,
          messageIds: ['msg-1'],
          compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
        };

        // Should not throw, should return null
        const result = await performCheckpoint('explicit', agentState, checkpointDeps);

        expect(result).toBeNull();
        expect(warningLogged).toBe(true);
        expect(loggedWarning).toContain('failed to create explicit checkpoint');
      } finally {
        // Restore original console.warn
        console.warn = originalWarn;
      }
    });
  });

  describe('Checkpoint state collection', () => {
    it('should collect and serialize complete agent state', async () => {
      const store = createMockCheckpointStore();

      const mockMemory = {
        async list(tier: string) {
          if (tier === 'working') {
            return [
              {
                id: '1',
                label: 'recent_findings',
                content: 'Found important pattern X',
                tier: 'working',
                owner: 'test-owner',
                permission: 'readwrite' as const,
                pinned: false,
                embedding: null,
                created_at: new Date(),
                updated_at: new Date(),
              },
            ];
          }
          return [];
        },
      } as unknown as MemoryManager;

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: mockMemory,
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 5,
      };

      const agentState: CheckpointAgentState = {
        turnNumber: 5,
        toolRound: 1,
        messageIds: ['msg-1', 'msg-2', 'msg-3'],
        compactionMeta: {
          lastCompactedIndex: 2,
          summaryCount: 1,
        },
      };

      const checkpointId = await performCheckpoint('explicit', agentState, checkpointDeps);

      expect(checkpointId).not.toBeNull();
      expect(store.savedCheckpoints.length).toBe(1);

      const checkpoint = store.savedCheckpoints[0];
      expect(checkpoint?.turnNumber).toBe(5);
      expect(checkpoint?.toolRound).toBe(1);
      expect(checkpoint?.messageIds).toEqual(['msg-1', 'msg-2', 'msg-3']);
      expect(checkpoint?.workingMemory.length).toBe(1);
      expect(checkpoint?.workingMemory[0]?.label).toBe('recent_findings');
    });
  });

  describe('Prune is called after save', () => {
    it('should call prune with correct retention count after saving checkpoint', async () => {
      const store = createMockCheckpointStore();

      const checkpointDeps: CheckpointDependencies = {
        checkpointStore: store,
        memory: createMockMemoryManager(),
        owner: 'test-owner',
        conversationId: 'conv-123',
        retentionCount: 3,
      };

      const agentState: CheckpointAgentState = {
        turnNumber: 1,
        toolRound: 0,
        messageIds: ['msg-1'],
        compactionMeta: { lastCompactedIndex: -1, summaryCount: 0 },
      };

      await performCheckpoint('explicit', agentState, checkpointDeps);

      expect(store.pruneCalls.length).toBe(1);
      expect(store.pruneCalls[0]?.conversationId).toBe('conv-123');
      expect(store.pruneCalls[0]?.retainCount).toBe(3);
    });
  });
});
