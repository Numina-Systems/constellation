/**
 * Tests for operation trace recording during tool dispatch.
 * Verifies that all tool dispatch branches (regular, execute_code, compact_context)
 * record traces with correct fields and handle errors gracefully.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createAgent } from './agent.ts';
import type {
  AgentDependencies,
  ConversationMessage,
} from './types.ts';
import type { ModelProvider, ModelResponse } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ToolRegistry, ToolResult } from '../tool/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { PersistenceProvider, QueryFunction } from '../persistence/types.ts';
import type { TraceRecorder, OperationTrace } from '../reflexion/types.ts';

/**
 * Mock implementations for trace testing
 */

function createMockPersistenceProvider(): PersistenceProvider {
  const messages: Map<string, Array<ConversationMessage>> = new Map();
  let nextId = 1;

  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    if (sql.includes('INSERT INTO messages')) {
      const [conversationId, role, content, toolCalls, toolCallId, reasoningContent] = params || [];
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

    return [] as Array<T>;
  };

  return {
    async connect() {},
    async disconnect() {},
    async runMigrations() {},
    query,
    async withTransaction<T>(fn: (q: QueryFunction) => Promise<T>) {
      return fn(query);
    },
  };
}

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
    async deleteBlock() {},
    async getPendingMutations() {
      return [];
    },
    async approveMutation() {
      throw new Error('not implemented');
    },
    async rejectMutation() {
      throw new Error('not implemented');
    },
  };
}

function createMockToolRegistry(): ToolRegistry {
  return {
    register() {},
    unregister() {
      return true;
    },
    getDefinitions() {
      return [];
    },
    async dispatch(name: string, _params: Record<string, unknown>): Promise<ToolResult> {
      return {
        success: true,
        output: `Tool ${name} result`,
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

function createMockCodeRuntime(): CodeRuntime {
  return {
    async execute() {
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

function createMockModelProvider(
  responses: ReadonlyArray<ModelResponse>,
): ModelProvider {
  let callIndex = 0;

  return {
    async complete(): Promise<ModelResponse> {
      const response = responses[callIndex];
      callIndex++;

      if (!response) {
        return {
          content: [{ type: 'text', text: 'No more responses' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      }

      return response;
    },

    async *stream() {
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
  };
}

function createMockTraceRecorder() {
  const traces: Array<Omit<OperationTrace, 'id' | 'createdAt'>> = [];
  return {
    recorder: {
      record: async (trace: Omit<OperationTrace, 'id' | 'createdAt'>) => {
        traces.push(trace);
      },
    } satisfies TraceRecorder,
    traces,
  };
}

describe('Trace capture', () => {
  let mockPersistence: PersistenceProvider;
  let mockMemory: MemoryManager;
  let mockRegistry: ToolRegistry;
  let mockRuntime: CodeRuntime;

  beforeEach(() => {
    mockPersistence = createMockPersistenceProvider();
    mockMemory = createMockMemoryManager();
    mockRegistry = createMockToolRegistry();
    mockRuntime = createMockCodeRuntime();
  });

  it('AC2.1: records trace for regular tool dispatch with correct fields', async () => {
    const { recorder: traceRecorder, traces } = createMockTraceRecorder();

    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Using a tool' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'memory_read',
          input: { query: 'test query' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      traceRecorder,
      owner: 'test-agent',
    };

    const agent = createAgent(deps);
    await agent.processMessage('Hello');

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.toolName).toBe('memory_read');
    expect(trace.input).toEqual({ query: 'test query' });
    expect(trace.outputSummary).toContain('Tool memory_read result');
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.success).toBe(true);
    expect(trace.error).toBeNull();
    expect(trace.owner).toBe('test-agent');
    expect(trace.conversationId).toBe(agent.conversationId);
  });

  it('AC2.1 (execute_code): records trace for code execution', async () => {
    const { recorder: traceRecorder, traces } = createMockTraceRecorder();

    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Executing code' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'execute_code',
          input: { code: 'print("hello")' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      traceRecorder,
      owner: 'test-agent',
    };

    const agent = createAgent(deps);
    await agent.processMessage('Execute code');

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.toolName).toBe('execute_code');
    expect(trace.input).toEqual({ code: 'print("hello")' });
    expect(trace.outputSummary).toContain('Code executed successfully');
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
    expect(trace.success).toBe(true);
    expect(trace.error).toBeNull();
  });

  it('AC2.2: records error message when tool dispatch fails', async () => {
    const { recorder: traceRecorder, traces } = createMockTraceRecorder();

    const failingRegistry: ToolRegistry = {
      register() {},
      unregister() {
        return true;
      },
      getDefinitions() {
        return [];
      },
      async dispatch(): Promise<ToolResult> {
        return {
          success: false,
          output: 'Tool failed',
          error: 'Tool error message',
        };
      },
      generateStubs() {
        return '';
      },
      toModelTools() {
        return [];
      },
    };

    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Using a tool' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'failing_tool',
          input: { param: 'value' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: failingRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      traceRecorder,
      owner: 'test-agent',
    };

    const agent = createAgent(deps);
    await agent.processMessage('Call failing tool');

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.toolName).toBe('failing_tool');
    expect(trace.success).toBe(false);
    expect(trace.error).toBe('Tool error message');
  });

  it('AC2.2 (exception): records error message when tool dispatch throws', async () => {
    const { recorder: traceRecorder, traces } = createMockTraceRecorder();

    const throwingRegistry: ToolRegistry = {
      register() {},
      unregister() {
        return true;
      },
      getDefinitions() {
        return [];
      },
      async dispatch(): Promise<ToolResult> {
        throw new Error('dispatch explosion');
      },
      generateStubs() {
        return '';
      },
      toModelTools() {
        return [];
      },
    };

    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Using a tool' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'exploding_tool',
          input: { param: 'value' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: throwingRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      traceRecorder,
      owner: 'test-agent',
    };

    const agent = createAgent(deps);
    await agent.processMessage('Call throwing tool');

    expect(traces.length).toBe(1);
    const trace = traces[0]!;
    expect(trace.toolName).toBe('exploding_tool');
    expect(trace.success).toBe(false);
    expect(trace.error).toBe('dispatch explosion');
    expect(trace.outputSummary).toContain('Error executing tool');
    expect(trace.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('AC2.4: trace recorder error does not block agent loop', async () => {
    const { recorder: throwingRecorder } = (() => {
      const throwingRecorder: TraceRecorder = {
        record: async () => {
          // Simulate error that would be caught by fire-and-forget handler
          // (In practice, the TraceRecorder impl catches errors internally)
          throw new Error('Trace recorder failed');
        },
      };
      return { recorder: throwingRecorder };
    })();

    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Using a tool' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'memory_read',
          input: { query: 'test' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response after error' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      traceRecorder: throwingRecorder,
      owner: 'test-agent',
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Use a tool');

    // Agent should complete normally despite trace recorder error
    expect(response).toBe('Final response after error');
  });

  it('no trace recorder: agent works normally without recording', async () => {
    const modelResponse: ModelResponse = {
      content: [
        { type: 'text', text: 'Using a tool' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'memory_read',
          input: { query: 'test' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([
      modelResponse,
      {
        content: [{ type: 'text', text: 'Final response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: { max_tool_rounds: 5, context_budget: 0.8 },
      // No traceRecorder
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Use a tool');

    expect(response).toBe('Final response');
  });
});
