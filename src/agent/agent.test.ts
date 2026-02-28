/**
 * Tests for the agent loop implementation.
 * Covers message processing, persistence, tool dispatch, context compression,
 * and max round enforcement.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { createAgent } from './agent.ts';
import type {
  Agent,
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

/**
 * Mock implementations for testing
 */

// Mock PersistenceProvider that stores messages in-memory
function createMockPersistenceProvider(): PersistenceProvider {
  const messages: Map<string, Array<ConversationMessage>> = new Map();
  let nextId = 1;

  const query: QueryFunction = async <T extends Record<string, unknown>>(
    sql: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<Array<T>> => {
    // Support INSERT and SELECT queries
    if (sql.includes('INSERT INTO messages')) {
      const [conversationId, role, content, toolCalls, toolCallId] = params || [];
      const id = String(nextId++);
      const message: ConversationMessage = {
        id,
        conversation_id: String(conversationId),
        role: role as ConversationMessage['role'],
        content: String(content),
        tool_calls: toolCalls,
        tool_call_id: toolCallId ? String(toolCallId) : undefined,
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

// Helper to create AgentDependencies with optional compactor
function createAgentDependencies(overrides?: {
  model?: ModelProvider;
  memory?: MemoryManager;
  registry?: ToolRegistry;
  runtime?: CodeRuntime;
  persistence?: PersistenceProvider;
  config?: AgentConfig;
  compactor?: Compactor;
}): AgentDependencies {
  return {
    model: overrides?.model ?? createMockModelProvider([]),
    memory: overrides?.memory ?? createMockMemoryManager(),
    registry: overrides?.registry ?? createMockToolRegistry(),
    runtime: overrides?.runtime ?? createMockCodeRuntime(),
    persistence: overrides?.persistence ?? createMockPersistenceProvider(),
    config: overrides?.config ?? { max_tool_rounds: 5, context_budget: 0.8 },
    compactor: overrides?.compactor,
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

// Integration test (requires real Postgres)
if (process.env['DATABASE_URL']) {
  describe('Agent loop (integration with Postgres)', () => {
    it.skip('AC1.2 (integration): persists to real database and loads history', async () => {
      // Integration test skipped for now - requires real database setup
      // Would test: create agent -> send message -> persist -> restart -> load history
    });
  });
}
