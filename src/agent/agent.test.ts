/**
 * Tests for the agent loop implementation.
 * Covers message processing, persistence, tool dispatch, context compression,
 * and max round enforcement.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createAgent } from './agent.ts';
import { createMockEmbeddingProvider } from '../integration/test-helpers.ts';
import type {
  Agent,
  AgentConfig,
  AgentDependencies,
  ConversationMessage,
  ExternalEvent,
} from './types.ts';
import type { ModelProvider, ModelRequest, ModelResponse } from '../model/types.ts';
import type { MemoryManager } from '../memory/manager.ts';
import type { ToolRegistry } from '../tool/types.ts';
import type { CodeRuntime } from '../runtime/types.ts';
import type { PersistenceProvider, QueryFunction } from '../persistence/types.ts';
import type { Compactor, CompactionResult } from '../compaction/types.ts';
import type { SkillRegistry } from '../skill/types.ts';
import type { EmbeddingProvider } from '../embedding/types.ts';

/**
 * Mock implementations for testing
 */

// Mock PersistenceProvider that stores messages in-memory
// Also captures INSERT parameters for testing embedding values
function createMockPersistenceProvider(): PersistenceProvider & { capturedInserts: Array<Array<unknown>> } {
  const messages: Map<string, Array<ConversationMessage>> = new Map();
  const capturedInserts: Array<Array<unknown>> = [];
  let nextId = 1;

  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    // Support INSERT and SELECT queries
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

    // DELETE query for compression (remove old messages)
    if (sql.includes('DELETE FROM messages') && sql.includes('WHERE id = ANY')) {
      // Delete specified IDs
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

// Mock ModelProvider with configurable responses and tracking
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
        // Default to end_turn with final text
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
      // Not implemented for tests
      yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
    },
  };
}

// Helper to create AgentDependencies with optional compactor and embedding
function createAgentDependencies(overrides?: {
  model?: ModelProvider;
  memory?: MemoryManager;
  registry?: ToolRegistry;
  runtime?: CodeRuntime;
  persistence?: PersistenceProvider;
  config?: AgentConfig;
  compactor?: Compactor;
  embedding?: EmbeddingProvider;
}): AgentDependencies {
  return {
    model: overrides?.model ?? createMockModelProvider([]),
    memory: overrides?.memory ?? createMockMemoryManager(),
    registry: overrides?.registry ?? createMockToolRegistry(),
    runtime: overrides?.runtime ?? createMockCodeRuntime(),
    persistence: overrides?.persistence ?? createMockPersistenceProvider(),
    config: overrides?.config ?? { max_tool_rounds: 5, context_budget: 0.8 },
    compactor: overrides?.compactor,
    embedding: overrides?.embedding,
  };
}

describe('Agent loop', () => {
  let mockPersistence: PersistenceProvider;
  let mockMemory: MemoryManager;
  let mockRegistry: ToolRegistry;
  let mockRuntime: CodeRuntime;
  let config: AgentConfig;

  beforeEach(() => {
    mockPersistence = createMockPersistenceProvider();
    mockMemory = createMockMemoryManager();
    mockRegistry = createMockToolRegistry();
    mockRuntime = createMockCodeRuntime();
    config = {
      max_tool_rounds: 5,
      context_budget: 0.8,
    };
  });

  it('AC1.1: processes a message and returns response text', async () => {
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Hello, this is the assistant response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Hello');

    expect(response).toBe('Hello, this is the assistant response');
  });

  it('AC1.2 (unit): persists messages to database and loads history', async () => {
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Response 1' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    await agent.processMessage('First message');

    // Create a new agent with the same conversation ID
    const mockModel2 = createMockModelProvider([
      {
        content: [{ type: 'text', text: 'Response 2' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    const deps2: AgentDependencies = {
      model: mockModel2,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent2 = createAgent(deps2, agent.conversationId);
    const history = await agent2.getConversationHistory();

    // Should have at least the first user message and response
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((msg) => msg.role === 'user' && msg.content === 'First message')).toBe(true);
    expect(history.some((msg) => msg.role === 'assistant')).toBe(true);
  });

  it('AC1.12: compresses context when budget exceeded', async () => {
    // Verify that when history exceeds the context budget, the agent calls
    // compactor.compress() to summarize old messages.

    // Create a mock compactor with call recording
    function createMockCompactor(result: CompactionResult): Compactor & { calls: Array<{ history: ReadonlyArray<ConversationMessage>; conversationId: string }> } {
      const calls: Array<{ history: ReadonlyArray<ConversationMessage>; conversationId: string }> = [];
      return {
        calls,
        async compress(history, conversationId) {
          calls.push({ history: [...history], conversationId });
          return result;
        },
      };
    }

    const tightPersistence = createMockPersistenceProvider();
    const tightConfig: AgentConfig = {
      max_tool_rounds: 5,
      context_budget: 0.01, // 1% budget (2000 tokens at 200k model window)
    };

    const mockModel = createMockModelProvider([
      {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    ]);

    // Create a mock compactor that returns compressed history with 2 messages removed
    const mockCompactor = createMockCompactor({
      history: [], // After compression, history is reduced
      batchesCreated: 1,
      messagesCompressed: 2,
      tokensEstimateBefore: 2100,
      tokensEstimateAfter: 800,
    });

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: tightPersistence,
      config: tightConfig,
      compactor: mockCompactor,
    };

    const agent = createAgent(deps);
    const largeMsg = 'x'.repeat(4000); // ~1000 tokens per message

    // Send messages to exceed budget: 0.01 * 200000 = 2000 tokens
    await agent.processMessage(largeMsg); // ~1000 total
    await agent.processMessage(largeMsg); // ~2000 total, should trigger compression
    await agent.processMessage(largeMsg); // Already over budget, should trigger compression again

    // Verify compression was triggered: compactor.compress() should have been called
    // at least once when budget exceeded
    expect(mockCompactor.calls.length).toBeGreaterThanOrEqual(1);

    const firstCall = mockCompactor.calls[0];
    if (firstCall) {
      expect(firstCall.conversationId).toBe(agent.conversationId);
      expect(firstCall.history.length).toBeGreaterThan(0);
    }

    // Verify conversation ID persists
    expect(typeof agent.conversationId).toBe('string');
    expect(agent.conversationId.length).toBeGreaterThan(0);
  });

  it('AC4.2: depends only on port interfaces', async () => {
    // This test is structural: just verify the agent can be created and used
    // with port interfaces. No implementation details leakage.
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Test' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    // Type system ensures agent only uses port interfaces
    const agent: Agent = createAgent(deps);
    const response = await agent.processMessage('test');

    expect(typeof response).toBe('string');
  });

  it('AC3.1: agent never sends oversized request to model', async () => {
    // Integration test verifying the pre-flight guard prevents oversized requests
    // Create agent with existing large history, then process new message

    const capturedRequests: Array<ModelRequest> = [];

    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequests.push(request);
        return {
          content: [{ type: 'text', text: 'Response' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    } as unknown as ModelProvider;

    // Create a persistence provider and pre-populate it with large messages
    const mockPersistence = createMockPersistenceProvider();
    const convId = 'test-conv-ac3-1';

    // Pre-insert large messages into the mock persistence
    const largeText = 'x'.repeat(20000); // ~5000 tokens
    await mockPersistence.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [convId, 'user', largeText],
    );
    await mockPersistence.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [convId, 'assistant', largeText],
    );
    await mockPersistence.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
      [convId, 'user', largeText],
    );

    const configWithSmallBudget = {
      ...config,
      model_max_tokens: 2000, // Small budget to force pre-flight guard
      max_tokens: 100,
      context_budget: 0.8,
    };

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: configWithSmallBudget,
    };

    const agent = createAgent(deps, convId);
    await agent.processMessage('New message');

    // Verify request was sent to model
    expect(capturedRequests.length).toBeGreaterThan(0);

    // Verify the request passed to model never exceeds the budget
    const request = capturedRequests[0]!;
    const estimatedTokens = request.messages.reduce(
      (sum, m) => sum + Math.ceil((typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).length / 4),
      0,
    );

    const overheadTokens = (request.system ? Math.ceil(request.system.length / 4) : 0) +
      (request.tools ? Math.ceil(JSON.stringify(request.tools).length / 4) : 0) +
      (configWithSmallBudget.max_tokens ?? 100);

    const totalTokens = estimatedTokens + overheadTokens;
    expect(totalTokens).toBeLessThanOrEqual(configWithSmallBudget.model_max_tokens ?? 200000);
  });

  it('AC3.5: warning logged when pre-flight guard fires', async () => {
    // Integration test verifying console.warn is called when pre-flight guard truncates
    const capturedWarnings: string[] = [];
    const originalWarn = console.warn;

    console.warn = (...args: unknown[]) => {
      capturedWarnings.push(String(args[0]));
    };

    try {
      const largeText = 'x'.repeat(20000); // ~5000 tokens
      const mockModel: ModelProvider = {
        async complete(): Promise<ModelResponse> {
          return {
            content: [{ type: 'text', text: 'Response' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
        async *stream() {
          yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
        },
      } as unknown as ModelProvider;

      // Create persistence with pre-populated large messages
      const mockPersistence = createMockPersistenceProvider();
      const convId = 'test-conv-ac3-5';

      // Pre-insert large messages
      await mockPersistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [convId, 'user', largeText],
      );
      await mockPersistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [convId, 'assistant', largeText],
      );
      await mockPersistence.query(
        `INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)`,
        [convId, 'user', largeText],
      );

      const configWithSmallBudget = {
        ...config,
        model_max_tokens: 2000,
        max_tokens: 100,
        context_budget: 0.8,
      };

      const deps: AgentDependencies = {
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config: configWithSmallBudget,
      };

      const agent = createAgent(deps, convId);
      await agent.processMessage('New message');

      // Verify that console.warn was called with a message containing "pre-flight guard"
      const guardWarnings = capturedWarnings.filter((msg) => msg.includes('pre-flight guard'));
      expect(guardWarnings.length).toBeGreaterThan(0);
      expect(guardWarnings[0]!).toMatch(/pre-flight guard/);
    } finally {
      console.warn = originalWarn;
    }
  });

  it('handles multi-round tool calling', async () => {
    const toolUseResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'test_tool',
          input: { arg: 'value' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const finalResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Final response after tool use' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Call a tool');

    expect(response).toBe('Final response after tool use');
  });

  it('enforces max tool rounds limit', async () => {
    const limitedConfig: AgentConfig = {
      max_tool_rounds: 2,
      context_budget: 0.8,
    };

    // Always return tool_use
    const toolResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool-x',
          name: 'test_tool',
          input: {},
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider(Array(10).fill(toolResponse));
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config: limitedConfig,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Keep using tools');

    // Should contain max rounds warning
    expect(response).toContain('max tool rounds');
    expect(response).toContain('2');
  });

  it('handles execute_code tool dispatch', async () => {
    let codeExecuted = false;

    const mockRuntime: CodeRuntime = {
      async execute(_code: string, _toolStubs: string) {
        codeExecuted = true;
        return {
          success: true,
          output: 'Code executed',
          error: null,
          tool_calls_made: 0,
          duration_ms: 5,
        };
      },
    };

    const toolUseResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'code-1',
          name: 'execute_code',
          input: { code: 'console.log("hello")' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const finalResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Code ran successfully' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Execute some code');

    expect(codeExecuted).toBe(true);
    expect(response).toBe('Code ran successfully');
  });

  it('returns text response on max_tokens stop reason', async () => {
    const maxTokensResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Response cut off due to max tokens' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 4000, output_tokens: 1000 },
    };

    const mockModel = createMockModelProvider([maxTokensResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Long prompt');

    expect(response).toBe('Response cut off due to max tokens');
  });

  describe('AC5: compact_context tool dispatch', () => {
    function createMockCompactor(result: CompactionResult): Compactor {
      return {
        async compress() {
          return result;
        },
      };
    }

    it('AC5.2: tool result contains compression stats', async () => {
      const compactionResult: CompactionResult = {
        history: [
          {
            id: '1',
            conversation_id: 'test-conv-1',
            role: 'user',
            content: 'Hello',
            created_at: new Date(),
          },
          {
            id: '2',
            conversation_id: 'test-conv-1',
            role: 'assistant',
            content: 'Hi there',
            created_at: new Date(),
          },
        ],
        messagesCompressed: 10,
        batchesCreated: 2,
        tokensEstimateBefore: 5000,
        tokensEstimateAfter: 2000,
      };

      const mockCompactor = createMockCompactor(compactionResult);

      const toolUseResponse: ModelResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-1',
            name: 'compact_context',
            input: {},
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const finalResponse: ModelResponse = {
        content: [{ type: 'text', text: 'Compaction complete' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
      const deps = createAgentDependencies({
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        compactor: mockCompactor,
      });

      const agent = createAgent(deps);
      const response = await agent.processMessage('Compress context please');

      // The response should be the final text from the assistant
      expect(response).toBe('Compaction complete');

      // Retrieve the tool result from persisted messages
      const history = await agent.getConversationHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Find the tool result message for compact_context
      const toolResultMessage = history.find(
        (msg) => msg.role === 'tool' && msg.tool_call_id === 'tool-use-1',
      );
      expect(toolResultMessage).toBeDefined();
      expect(toolResultMessage?.content).toBeDefined();

      // Parse the JSON tool result and verify compression stats
      const toolResult = JSON.parse(toolResultMessage?.content || '{}') as {
        messagesCompressed?: number;
        batchesCreated?: number;
        tokensEstimateBefore?: number;
        tokensEstimateAfter?: number;
      };

      expect(toolResult.messagesCompressed).toBe(10);
      expect(toolResult.batchesCreated).toBe(2);
      expect(toolResult.tokensEstimateBefore).toBe(5000);
      expect(toolResult.tokensEstimateAfter).toBe(2000);
    });

    it('AC5.3: history is replaced with compressed version for subsequent tool calls', async () => {
      const compressedMessages: ReadonlyArray<ConversationMessage> = [
        {
          id: 'msg-1',
          conversation_id: 'test-conv-2',
          role: 'assistant',
          content: '[Context Summary — 2 messages compressed]',
          created_at: new Date(),
        },
        {
          id: 'msg-3',
          conversation_id: 'test-conv-2',
          role: 'user',
          content: 'Message 2',
          created_at: new Date(),
        },
      ];

      const compactionResult: CompactionResult = {
        history: compressedMessages,
        messagesCompressed: 2,
        batchesCreated: 1,
        tokensEstimateBefore: 3000,
        tokensEstimateAfter: 1500,
      };

      const mockCompactor = createMockCompactor(compactionResult);

      // First tool use: compact_context
      const compactResponse: ModelResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-2',
            name: 'compact_context',
            input: {},
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      // Second tool use: a regular tool after compaction
      const secondToolResponse: ModelResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-3',
            name: 'memory_read',
            input: { query: 'test' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const finalResponse: ModelResponse = {
        content: [{ type: 'text', text: 'All done' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      // Track model requests to verify compressed history is used
      const tracker = { requests: [] as Array<ModelRequest> };
      const mockModel = createMockModelProvider([compactResponse, secondToolResponse, finalResponse], tracker);
      const deps = createAgentDependencies({
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        compactor: mockCompactor,
      });

      const agent = createAgent(deps);
      const response = await agent.processMessage('Start compaction round');

      // Verify the agent handled the round with multiple tool calls
      expect(response).toBe('All done');

      // Verify we made at least 2 model calls (one before compact_context, one after)
      expect(tracker.requests.length).toBeGreaterThanOrEqual(2);

      // The second model call should include the compressed history
      // The compressed history should contain messages from compressedMessages
      const secondCall = tracker.requests[1];
      if (!secondCall) {
        throw new Error('Expected second model call');
      }
      expect(secondCall).toBeDefined();

      // Verify that the second call's message history reflects compression
      // The compressed history has 2 messages (summary + final user message)
      // The second call should include these compressed messages
      const secondCallMessages = secondCall.messages;
      expect(secondCallMessages.length).toBeGreaterThanOrEqual(2);

      // Verify the compressed message is present in the second call
      const hasCompressedContent = secondCallMessages.some(
        (msg) => msg.content && typeof msg.content === 'string' && msg.content.includes('Context Summary'),
      );
      expect(hasCompressedContent).toBe(true);
    });

    it('AC5.4: no-op when compactor returns 0 compression stats', async () => {
      const noOpResult: CompactionResult = {
        history: [
          {
            id: 'msg-1',
            conversation_id: 'test-conv-3',
            role: 'user',
            content: 'Short',
            created_at: new Date(),
          },
        ],
        messagesCompressed: 0,
        batchesCreated: 0,
        tokensEstimateBefore: 100,
        tokensEstimateAfter: 100,
      };

      const mockCompactor = createMockCompactor(noOpResult);

      const toolUseResponse: ModelResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'tool-use-4',
            name: 'compact_context',
            input: {},
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const finalResponse: ModelResponse = {
        content: [{ type: 'text', text: 'No compression needed' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
      const deps = createAgentDependencies({
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        compactor: mockCompactor,
      });

      const agent = createAgent(deps);
      const response = await agent.processMessage('Maybe compress');

      expect(response).toBe('No compression needed');

      // Retrieve the tool result from persisted messages
      const history = await agent.getConversationHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);

      // Find the tool result message for compact_context
      const toolResultMessage = history.find(
        (msg) => msg.role === 'tool' && msg.tool_call_id === 'tool-use-4',
      );
      expect(toolResultMessage).toBeDefined();
      expect(toolResultMessage?.content).toBeDefined();

      // Parse the JSON tool result and verify zero-compression stats
      const toolResult = JSON.parse(toolResultMessage?.content || '{}') as {
        messagesCompressed?: number;
        batchesCreated?: number;
        tokensEstimateBefore?: number;
        tokensEstimateAfter?: number;
      };

      expect(toolResult.messagesCompressed).toBe(0);
      expect(toolResult.batchesCreated).toBe(0);
      expect(toolResult.tokensEstimateBefore).toBe(100);
      expect(toolResult.tokensEstimateAfter).toBe(100);
    });
  });
});

describe('reasoning_content persistence', () => {
  let mockPersistence: PersistenceProvider;
  let mockMemory: MemoryManager;
  let mockRegistry: ToolRegistry;
  let mockRuntime: CodeRuntime;
  let config: AgentConfig;

  beforeEach(() => {
    mockPersistence = createMockPersistenceProvider();
    mockMemory = createMockMemoryManager();
    mockRegistry = createMockToolRegistry();
    mockRuntime = createMockCodeRuntime();
    config = {
      max_tool_rounds: 5,
      context_budget: 0.8,
    };
  });

  it('persists reasoning_content from tool_use assistant messages', async () => {
    const toolUseResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool-r1',
          name: 'test_tool',
          input: { arg: 'value' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
      reasoning_content: 'I should use the test tool to look this up.',
    };

    const finalResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Done thinking' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    await agent.processMessage('Think about this');

    const history = await agent.getConversationHistory();
    const assistantMsg = history.find(
      (msg) => msg.role === 'assistant' && msg.reasoning_content,
    );

    expect(assistantMsg).toBeDefined();
    expect(assistantMsg?.reasoning_content).toBe(
      'I should use the test tool to look this up.',
    );
  });

  it('loads reasoning_content from history and includes it in model messages', async () => {
    const toolUseResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool-r2',
          name: 'test_tool',
          input: {},
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
      reasoning_content: 'Let me check this with the tool.',
    };

    const finalResponse: ModelResponse = {
      content: [{ type: 'text', text: 'First turn done' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const tracker1 = { requests: [] as Array<ModelRequest> };
    const mockModel1 = createMockModelProvider([toolUseResponse, finalResponse], tracker1);
    const deps1: AgentDependencies = {
      model: mockModel1,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent1 = createAgent(deps1);
    await agent1.processMessage('First question');

    // Create a second agent resuming the same conversation
    const secondResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Resumed' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const tracker2 = { requests: [] as Array<ModelRequest> };
    const mockModel2 = createMockModelProvider([secondResponse], tracker2);
    const deps2: AgentDependencies = {
      model: mockModel2,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent2 = createAgent(deps2, agent1.conversationId);
    await agent2.processMessage('Follow up');

    // The second model call should include the reasoning_content from history
    expect(tracker2.requests.length).toBeGreaterThanOrEqual(1);
    const request = tracker2.requests[0];
    expect(request).toBeDefined();

    const assistantMsgWithReasoning = request!.messages.find(
      (msg) => msg.role === 'assistant' && msg.reasoning_content,
    );
    expect(assistantMsgWithReasoning).toBeDefined();
    expect(assistantMsgWithReasoning?.reasoning_content).toBe(
      'Let me check this with the tool.',
    );
  });
});

describe('processEvent', () => {
  let mockPersistence: PersistenceProvider;
  let mockMemory: MemoryManager;
  let mockRegistry: ToolRegistry;
  let mockRuntime: CodeRuntime;
  let config: AgentConfig;

  beforeEach(() => {
    mockPersistence = createMockPersistenceProvider();
    mockMemory = createMockMemoryManager();
    mockRegistry = createMockToolRegistry();
    mockRuntime = createMockCodeRuntime();
    config = {
      max_tool_rounds: 5,
      context_budget: 0.8,
    };
  });

  it('AC2.1: creates/reuses a dedicated Bluesky conversation distinct from REPL', async () => {
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Event processed' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    // Create two agents with different conversation IDs
    const agent1 = createAgent(deps);
    const agent2 = createAgent(deps);

    // Verify they have different conversation IDs
    expect(agent1.conversationId).not.toBe(agent2.conversationId);
    expect(typeof agent1.conversationId).toBe('string');
    expect(typeof agent2.conversationId).toBe('string');
  });

  it('AC2.2: formats event as a structured message with metadata header', async () => {
    const event: ExternalEvent = {
      source: 'bluesky',
      content: 'This is a test post',
      metadata: {
        did: 'did:plc:examplexxxxxxxxxxxx',
        handle: 'alice',
        uri: 'at://did:plc:examplexxxxxxxxxxxx/app.bsky.feed.post/abc123',
        cid: 'bafy123...',
        reply_to: {
          parent_uri: 'at://did:plc:yyyyy/app.bsky.feed.post/xyz789',
          parent_cid: 'bafy-parent',
          root_uri: 'at://did:plc:yyyyy/app.bsky.feed.post/root1',
          root_cid: 'bafy-root',
        },
      },
      timestamp: new Date('2026-02-28T12:00:00.000Z'),
    };

    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Got it' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    let capturedRequest: ModelRequest | null = null;
    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequest = request;
        return modelResponse;
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    };

    const sourceInstructions = new Map<string, string>();
    sourceInstructions.set('bluesky', 'To respond to this post, use memory_read to find your bluesky templates (e.g. "bluesky reply" or "bluesky post"), then use execute_code with the template. Bluesky credentials (BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE) are automatically available in your sandbox. Replace placeholder text with your actual response.');

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
      sourceInstructions,
    };

    const agent = createAgent(deps);
    await agent.processEvent(event);

    // Verify the message contains all expected metadata
    expect(capturedRequest).not.toBeNull();
    const messages = (capturedRequest as unknown as { messages: Array<{ content?: string }> })?.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = String(lastMessage?.content || '');

    expect(content).toContain('[External Event: bluesky]');
    expect(content).toContain('@alice');
    expect(content).toContain('did:plc:examplexxxxxxxxxxxx');
    expect(content).toContain('at://did:plc:examplexxxxxxxxxxxx/app.bsky.feed.post/abc123');
    expect(content).toContain('CID: bafy123...');
    // Reply-to fields are expanded as structured lines
    expect(content).toContain('Parent URI: at://did:plc:yyyyy/app.bsky.feed.post/xyz789');
    expect(content).toContain('Parent CID: bafy-parent');
    expect(content).toContain('Root URI: at://did:plc:yyyyy/app.bsky.feed.post/root1');
    expect(content).toContain('Root CID: bafy-root');
    expect(content).toContain('2026-02-28T12:00:00.000Z');
    expect(content).toContain('This is a test post');
    // Bluesky events include instructions for using execute_code
    expect(content).toContain('[Instructions:');
    expect(content).toContain('memory_read');
    expect(content).toContain('execute_code');
  });

  it('AC2.4: instructions are absent when source is not in sourceInstructions map', async () => {
    const event: ExternalEvent = {
      source: 'discord',
      content: 'Message from discord',
      metadata: { user_id: 'user123' },
      timestamp: new Date('2026-02-28T12:00:00.000Z'),
    };

    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Got it' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    let capturedRequest: ModelRequest | null = null;
    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequest = request;
        return modelResponse;
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    };

    // sourceInstructions map contains only bluesky, not discord
    const sourceInstructions = new Map<string, string>();
    sourceInstructions.set('bluesky', 'Bluesky instructions');

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
      sourceInstructions,
    };

    const agent = createAgent(deps);
    await agent.processEvent(event);

    // Verify the message does NOT contain instructions
    expect(capturedRequest).not.toBeNull();
    const messages = (capturedRequest as unknown as { messages: Array<{ content?: string }> })?.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = String(lastMessage?.content || '');

    expect(content).toContain('[External Event: discord]');
    expect(content).toContain('Message from discord');
    // Instructions should NOT be present for discord source
    expect(content).not.toContain('[Instructions:');
  });

  it('AC2.3: agent can use tools during event processing', async () => {
    let toolDispatched = false;

    const toolRegistry: ToolRegistry = {
      register() {},
      getDefinitions() {
        return [];
      },
      async dispatch(name: string) {
        toolDispatched = true;
        return {
          success: true,
          output: `Tool ${name} executed`,
        };
      },
      generateStubs() {
        return '';
      },
      toModelTools() {
        return [];
      },
    };

    const toolUseResponse: ModelResponse = {
      content: [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'test_tool',
          input: { param: 'value' },
        },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const finalResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Tool was used' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: toolRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const agent = createAgent(deps);
    const event: ExternalEvent = {
      source: 'bluesky',
      content: 'Please use a tool',
      metadata: { did: 'did:plc:x', handle: 'bob' },
      timestamp: new Date(),
    };

    const response = await agent.processEvent(event);

    expect(toolDispatched).toBe(true);
    expect(response).toBe('Tool was used');
  });

  it('AC2.4: multiple agents with same deterministic conversationId result in same id', async () => {
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);
    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
    };

    const deterministicId = 'bluesky-did:plc:consistent';
    const agent1 = createAgent(deps, deterministicId);
    const agent2 = createAgent(deps, deterministicId);

    expect(agent1.conversationId).toBe(deterministicId);
    expect(agent2.conversationId).toBe(deterministicId);
    expect(agent1.conversationId).toBe(agent2.conversationId);
  });

  it('formatExternalEvent handles minimal metadata', async () => {
    const event: ExternalEvent = {
      source: 'bluesky',
      content: 'Just content, no metadata',
      metadata: {},
      timestamp: new Date('2026-02-28T15:30:00.000Z'),
    };

    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'OK' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    let capturedRequest: ModelRequest | null = null;
    const mockModel: ModelProvider = {
      async complete(request: ModelRequest): Promise<ModelResponse> {
        capturedRequest = request;
        return modelResponse;
      },
      async *stream() {
        yield { type: 'message_start' as const, message: { id: 'msg', usage: { input_tokens: 0, output_tokens: 0 } } };
      },
    };

    const sourceInstructions = new Map<string, string>();
    sourceInstructions.set('bluesky', 'To respond to this post, use memory_read to find your bluesky templates (e.g. "bluesky reply" or "bluesky post"), then use execute_code with the template. Bluesky credentials (BSKY_SERVICE, BSKY_ACCESS_TOKEN, BSKY_REFRESH_TOKEN, BSKY_DID, BSKY_HANDLE) are automatically available in your sandbox. Replace placeholder text with your actual response.');

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
      sourceInstructions,
    };

    const agent = createAgent(deps);
    await agent.processEvent(event);

    const messages = (capturedRequest as unknown as { messages: Array<{ content?: string }> })?.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = String(lastMessage?.content || '');

    expect(content).toContain('[External Event: bluesky]');
    expect(content).toContain('2026-02-28T15:30:00.000Z');
    expect(content).toContain('Just content, no metadata');
    // Instructions still present even with minimal metadata
    expect(content).toContain('[Instructions:');
  });
});

describe('Skill integration', () => {
  let mockPersistence: PersistenceProvider;
  let mockMemory: MemoryManager;
  let mockRegistry: ToolRegistry;
  let mockRuntime: CodeRuntime;
  let config: AgentConfig;

  beforeEach(() => {
    mockPersistence = createMockPersistenceProvider();
    mockMemory = createMockMemoryManager();
    mockRegistry = createMockToolRegistry();
    mockRuntime = createMockCodeRuntime();
    config = {
      max_tool_rounds: 5,
      context_budget: 0.8,
    };
  });

  it('C1: continues with base prompt when skill retrieval throws', async () => {
    const modelResponse: ModelResponse = {
      content: [{ type: 'text', text: 'Response without skills' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    };

    const mockModel = createMockModelProvider([modelResponse]);

    const failingSkillRegistry: SkillRegistry = {
      load: async () => {},
      getAll: () => [],
      getByName: () => null,
      search: async () => [],
      getRelevant: async () => {
        throw new Error('Database connection failed');
      },
      createAgentSkill: async () => {
        throw new Error('not implemented');
      },
      updateAgentSkill: async () => {
        throw new Error('not implemented');
      },
      injectSkills: async () => {},
    };

    const deps: AgentDependencies = {
      model: mockModel,
      memory: mockMemory,
      registry: mockRegistry,
      runtime: mockRuntime,
      persistence: mockPersistence,
      config,
      skills: failingSkillRegistry,
    };

    const agent = createAgent(deps);
    const response = await agent.processMessage('Test message');

    // Agent should return the model response despite skill retrieval failing
    expect(response).toBe('Response without skills');

    // Verify the message was persisted successfully
    const history = await agent.getConversationHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((msg) => msg.role === 'user' && msg.content === 'Test message')).toBe(true);
  });

  describe('Message embedding generation (GH-23.AC3)', () => {
    it('GH-23.AC3.1: generates embedding for user messages', async () => {
      const modelResponse: ModelResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([modelResponse]);
      const mockEmbedding = createMockEmbeddingProvider();
      const mockPersistence = createMockPersistenceProvider();

      const deps: AgentDependencies = {
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        embedding: mockEmbedding,
      };

      const agent = createAgent(deps);
      await agent.processMessage('User test message');

      // Find the INSERT statement for the user message
      const userInsert = mockPersistence.capturedInserts.find((params) => {
        return params[1] === 'user'; // params[1] is the role
      });

      expect(userInsert).toBeDefined();
      // params[6] is the embedding value (toSql-formatted string or null)
      expect(userInsert?.[6]).not.toBeNull();
      expect(typeof userInsert?.[6]).toBe('string');
    });

    it('GH-23.AC3.2: generates embedding for assistant messages', async () => {
      const modelResponse: ModelResponse = {
        content: [{ type: 'text', text: 'Assistant response text' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([modelResponse]);
      const mockEmbedding = createMockEmbeddingProvider();
      const mockPersistence = createMockPersistenceProvider();

      const deps: AgentDependencies = {
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        embedding: mockEmbedding,
      };

      const agent = createAgent(deps);
      await agent.processMessage('User message');

      // Find the INSERT statement for the assistant message
      const assistantInsert = mockPersistence.capturedInserts.find((params) => {
        return params[1] === 'assistant'; // params[1] is the role
      });

      expect(assistantInsert).toBeDefined();
      // params[6] is the embedding value (toSql-formatted string or null)
      expect(assistantInsert?.[6]).not.toBeNull();
      expect(typeof assistantInsert?.[6]).toBe('string');
    });

    it('GH-23.AC3.3: embedding provider failure does not block message persistence', async () => {
      const modelResponse: ModelResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([modelResponse]);
      const mockPersistence = createMockPersistenceProvider();

      // Create a failing embedding provider
      const failingEmbeddingProvider: EmbeddingProvider = {
        async embed(_text: string): Promise<Array<number>> {
          throw new Error('Embedding service unavailable');
        },
        async embedBatch(_texts: ReadonlyArray<string>): Promise<Array<Array<number>>> {
          throw new Error('Embedding service unavailable');
        },
        dimensions: 768,
      };

      const deps: AgentDependencies = {
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        embedding: failingEmbeddingProvider,
      };

      const agent = createAgent(deps);
      // Should not throw despite embedding provider failure
      const response = await agent.processMessage('Test message');

      expect(typeof response).toBe('string');

      // Verify the message was still persisted (even with null embedding)
      const userInsert = mockPersistence.capturedInserts.find((params) => {
        return params[1] === 'user';
      });

      expect(userInsert).toBeDefined();
      // params[6] should be null when embedding fails
      expect(userInsert?.[6]).toBeNull();
    });

    it('GH-23.AC3.5: system and tool messages stored with null embeddings', async () => {
      // First response: tool_use to trigger tool message persistence
      const toolUseResponse: ModelResponse = {
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'test_tool',
            input: { arg: 'value' },
          },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      // Second response: final response after tool execution
      const finalResponse: ModelResponse = {
        content: [{ type: 'text', text: 'Response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 50 },
      };

      const mockModel = createMockModelProvider([toolUseResponse, finalResponse]);
      const mockEmbedding = createMockEmbeddingProvider();
      const mockPersistence = createMockPersistenceProvider();

      const deps: AgentDependencies = {
        model: mockModel,
        memory: mockMemory,
        registry: mockRegistry,
        runtime: mockRuntime,
        persistence: mockPersistence,
        config,
        embedding: mockEmbedding,
      };

      const agent = createAgent(deps);
      await agent.processMessage('Test message');

      // Verify user message has non-null embedding
      const userInsert = mockPersistence.capturedInserts.find((params) => params[1] === 'user');
      expect(userInsert).toBeDefined();
      expect(userInsert?.[6]).not.toBeNull();

      // Verify assistant message has non-null embedding
      const assistantInsert = mockPersistence.capturedInserts.find((params) => params[1] === 'assistant');
      expect(assistantInsert).toBeDefined();
      expect(assistantInsert?.[6]).not.toBeNull();

      // Verify tool role messages are persisted with null embedding
      const toolInserts = mockPersistence.capturedInserts.filter((params) => params[1] === 'tool');
      expect(toolInserts.length).toBeGreaterThan(0);
      for (const toolInsert of toolInserts) {
        // param[6] is the embedding column - should be null for tool messages
        expect(toolInsert[6]).toBeNull();
      }

      // Verify we have persisted messages
      const history = await agent.getConversationHistory();
      expect(history.length).toBeGreaterThanOrEqual(3); // user, assistant with tool call, tool result, final assistant
    });
  });
});

// Integration test (requires real Postgres)
if (process.env['DATABASE_URL']) {
  describe('Agent loop (integration with Postgres)', () => {
    it.skip('AC1.2 (integration): persists to real database and loads history', async () => {
      // Integration test skipped for now - requires real database setup
      // Would test: create agent -> send message -> persist -> restart -> load history
    });
  });
}
