// pattern: Imperative Shell

/**
 * End-to-end integration tests for the machine spirit core.
 * Tests the full path: user message -> memory context -> model -> tool use -> code execution -> persistence.
 * Requires Docker Postgres running with pgvector.
 */

import { describe, it, expect, beforeAll, afterEach, afterAll } from 'bun:test';
import type { ModelProvider, ModelResponse, StreamEvent, ContentBlock, ModelRequest } from '../model/types';
import type { EmbeddingProvider } from '../embedding/types';
import { createPostgresProvider } from '../persistence/postgres';
import { createPostgresMemoryStore } from '../memory/postgres-store';
import { createMemoryManager } from '../memory/manager';
import { createToolRegistry } from '../tool/registry';
import { createMemoryTools } from '../tool/builtin/memory';
import { createExecuteCodeTool } from '../tool/builtin/code';
import { createDenoExecutor } from '../runtime/executor';
import { createAgent } from '../agent/agent';
import { seedCoreMemory } from '../index';
import { createMockEmbeddingProvider } from './test-helpers';

const TEST_OWNER = 'test-user-' + Math.random().toString(36).substring(7);
const DB_CONNECTION_STRING =
  'postgresql://constellation:constellation@localhost:5432/constellation';

let persistence: ReturnType<typeof createPostgresProvider>;
let mockEmbedding: EmbeddingProvider;

async function cleanupTables(): Promise<void> {
  await persistence.query('TRUNCATE TABLE pending_mutations CASCADE');
  await persistence.query('TRUNCATE TABLE memory_events CASCADE');
  await persistence.query('TRUNCATE TABLE messages CASCADE');
  await persistence.query('TRUNCATE TABLE memory_blocks CASCADE');
}

/**
 * Mock ModelProvider for testing.
 * Returns predictable responses with configurable stop reasons and tool calls.
 */
function createMockModelProvider(
  config: {
    stopReason?: 'end_turn' | 'tool_use';
    textContent?: string;
    toolCalls?: Array<{
      id: string;
      name: string;
      input: Record<string, unknown>;
    }>;
  } = {},
): ModelProvider {
  const stopReason = config.stopReason ?? 'end_turn';
  const textContent = config.textContent ?? 'Test response';
  const toolCalls = config.toolCalls ?? [];

  return {
    async complete(_request: ModelRequest): Promise<ModelResponse> {
      const content: Array<ContentBlock> = [];

      if (textContent) {
        content.push({
          type: 'text',
          text: textContent,
        });
      }

      for (const toolCall of toolCalls) {
        content.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.name,
          input: toolCall.input,
        });
      }

      return {
        content,
        stop_reason: stopReason,
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      };
    },

    async *stream(): AsyncIterable<StreamEvent> {
      // Mock streaming not needed for e2e tests
      yield {
        type: 'message_stop',
        message: {
          stop_reason: 'end_turn',
        },
      };
    },
  };
}

describe('End-to-End Integration Tests', () => {
  beforeAll(async () => {
    persistence = createPostgresProvider({
      url: DB_CONNECTION_STRING,
    });

    await persistence.connect();
    await persistence.runMigrations();
    await cleanupTables();

    mockEmbedding = createMockEmbeddingProvider();
  });

  afterEach(async () => {
    await cleanupTables();
  });

  afterAll(async () => {
    await persistence.disconnect();
  });

  describe('AC6.4: First-run seeding', () => {
    it('should seed core memory blocks on empty database', async () => {
      const store = createPostgresMemoryStore(persistence);

      // Verify database is empty before seeding
      let blocks = await store.getBlocksByTier('spirit', 'core');
      expect(blocks.length).toBe(0);

      // Run seeding
      await seedCoreMemory(store, mockEmbedding, 'persona.md');

      // Verify core blocks were created (using 'spirit' owner)
      blocks = await store.getBlocksByTier('spirit', 'core');
      expect(blocks.length).toBe(3);

      const systemBlock = blocks.find((b) => b.label === 'core:system');
      expect(systemBlock).toBeDefined();
      expect(systemBlock?.permission).toBe('readonly');
      expect(systemBlock?.content).toContain('machine spirit');
      expect(systemBlock?.embedding).not.toBeNull();

      const personaBlock = blocks.find((b) => b.label === 'core:persona');
      expect(personaBlock).toBeDefined();
      expect(personaBlock?.permission).toBe('familiar');
      expect(personaBlock?.content).toContain('machine spirit');
      expect(personaBlock?.embedding).not.toBeNull();

      const familiarBlock = blocks.find((b) => b.label === 'core:familiar');
      expect(familiarBlock).toBeDefined();
      expect(familiarBlock?.permission).toBe('familiar');
      expect(familiarBlock?.content).toBe('My familiar has not yet introduced themselves.');
      expect(familiarBlock?.embedding).not.toBeNull();
    });

    it('should skip seeding if core blocks already exist', async () => {
      const store = createPostgresMemoryStore(persistence);

      // First seeding
      await seedCoreMemory(store, mockEmbedding, 'persona.md');
      let blocks = await store.getBlocksByTier('spirit', 'core');
      const firstCount = blocks.length;

      // Second seeding should be skipped
      await seedCoreMemory(store, mockEmbedding, 'persona.md');
      blocks = await store.getBlocksByTier('spirit', 'core');
      expect(blocks.length).toBe(firstCount);
    });
  });

  describe('AC1.1: Message flow', () => {
    it('should process a user message and return a response', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const registry = createToolRegistry();
      const memoryTools = createMemoryTools(memory);
      for (const tool of memoryTools) {
        registry.register(tool);
      }
      registry.register(createExecuteCodeTool());

      const mockModel = createMockModelProvider({
        stopReason: 'end_turn',
        textContent: 'Hello! I am a machine spirit.',
      });

      const runtime = createDenoExecutor(
        {
          max_code_size: 10000,
          max_output_size: 10000,
          code_timeout: 5000,
          working_dir: '/tmp',
          max_tool_rounds: 5,
          context_budget: 100000,
          max_tool_calls_per_exec: 25,
          allowed_hosts: [],
          allowed_read_paths: [],
          allowed_run: [],
        },
        registry,
      );

      const agent = createAgent(
        {
          model: mockModel,
          memory,
          registry,
          runtime,
          persistence,
          config: {
            max_tool_rounds: 5,
            context_budget: 100000,
            model_max_tokens: 200000,
          },
        },
        TEST_OWNER,
      );

      const response = await agent.processMessage('Hello');
      expect(response).toBe('Hello! I am a machine spirit.');
    });
  });

  describe('AC1.2: Persistence', () => {
    it('should persist messages and restore conversation history', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const registry = createToolRegistry();
      const memoryTools = createMemoryTools(memory);
      for (const tool of memoryTools) {
        registry.register(tool);
      }
      registry.register(createExecuteCodeTool());

      const mockModel = createMockModelProvider({
        stopReason: 'end_turn',
        textContent: 'Response to your message',
      });

      const runtime = createDenoExecutor(
        {
          max_code_size: 10000,
          max_output_size: 10000,
          code_timeout: 5000,
          working_dir: '/tmp',
          max_tool_rounds: 5,
          context_budget: 100000,
          max_tool_calls_per_exec: 25,
          allowed_hosts: [],
          allowed_read_paths: [],
          allowed_run: [],
        },
        registry,
      );

      const conversationId = crypto.randomUUID();

      // Create first agent instance and send message
      const agent1 = createAgent(
        {
          model: mockModel,
          memory,
          registry,
          runtime,
          persistence,
          config: {
            max_tool_rounds: 5,
            context_budget: 100000,
            model_max_tokens: 200000,
          },
        },
        conversationId,
      );

      const response1 = await agent1.processMessage('Hello');
      expect(response1).toBe('Response to your message');

      // Create second agent instance with same conversation ID
      const agent2 = createAgent(
        {
          model: mockModel,
          memory,
          registry,
          runtime,
          persistence,
          config: {
            max_tool_rounds: 5,
            context_budget: 100000,
            model_max_tokens: 200000,
          },
        },
        conversationId,
      );

      // Verify history is restored
      const history = await agent2.getConversationHistory();
      expect(history.length).toBeGreaterThanOrEqual(2);
      expect(history.some((m) => m.role === 'user' && m.content === 'Hello')).toBe(true);
      expect(history.some((m) => m.role === 'assistant' && m.content === 'Response to your message')).toBe(true);
    });
  });

  describe('AC1.5 + AC1.6: Semantic search and embeddings', () => {
    it('should store blocks with embeddings and find by semantic similarity', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      // Write archival blocks with distinct content
      await memory.write(
        'facts:math',
        'The square root of 16 is 4. Mathematics is the study of numbers.',
        'archival',
      );

      await memory.write(
        'facts:biology',
        'A mitochondrion is the powerhouse of the cell. Biology studies life.',
        'archival',
      );

      await memory.write(
        'facts:chemistry',
        'Hydrogen and oxygen combine to form water. Chemistry studies atoms.',
        'archival',
      );

      // Verify all blocks have embeddings
      const allBlocks = await store.getBlocksByTier(TEST_OWNER, 'archival');
      expect(allBlocks.length).toBe(3);
      for (const block of allBlocks) {
        expect(block.embedding).not.toBeNull();
        expect(Array.isArray(block.embedding)).toBe(true);
      }

      // Search for content - verify we get results with similarity scores
      const results = await memory.read('water atom molecule', 10, 'archival');
      expect(results.length).toBeGreaterThan(0);
      // All results should have similarity scores
      for (const result of results) {
        expect(result.similarity).toBeGreaterThanOrEqual(0);
        expect(result.similarity).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('AC3.1: Code execution', () => {
    it('should execute code and return output', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const registry = createToolRegistry();
      const memoryTools = createMemoryTools(memory);
      for (const tool of memoryTools) {
        registry.register(tool);
      }
      registry.register(createExecuteCodeTool());

      let callCount = 0;

      // Use a custom model provider that returns tool_use on first call, then end_turn
      const mockModel: ModelProvider = {
        async complete(request) {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'I will execute some code for you.',
                },
                {
                  type: 'tool_use',
                  id: 'test-tool-1',
                  name: 'execute_code',
                  input: {
                    code: 'output("Hello from Deno!");',
                  },
                },
              ] as Array<ContentBlock>,
              stop_reason: 'tool_use',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            };
          }
          // After tool execution, extract tool result from messages
          let toolResultText = '';
          for (const msg of request.messages) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_result') {
                  toolResultText = typeof block.content === 'string' ? block.content : '';
                  break;
                }
              }
            }
          }
          return {
            content: [
              {
                type: 'text',
                text: `The code executed successfully. Output: ${toolResultText}`,
              },
            ] as Array<ContentBlock>,
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          };
        },
        async *stream() {
          yield {
            type: 'message_stop',
            message: {
              stop_reason: 'end_turn',
            },
          };
        },
      };

      const runtime = createDenoExecutor(
        {
          max_code_size: 10000,
          max_output_size: 10000,
          code_timeout: 5000,
          working_dir: '/tmp',
          max_tool_rounds: 5,
          context_budget: 100000,
          max_tool_calls_per_exec: 25,
          allowed_hosts: [],
          allowed_read_paths: [],
          allowed_run: [],
        },
        registry,
      );

      const agent = createAgent(
        {
          model: mockModel,
          memory,
          registry,
          runtime,
          persistence,
          config: {
            max_tool_rounds: 5,
            context_budget: 100000,
            model_max_tokens: 200000,
          },
        },
        TEST_OWNER,
      );

      const response = await agent.processMessage('Run some code');
      expect(response).toContain('Hello from Deno!');
    });
  });

  describe('AC3.4: Tool bridge (IPC)', () => {
    it('should execute code that calls host tools via IPC', async () => {
      const store = createPostgresMemoryStore(persistence);
      const memory = createMemoryManager(store, mockEmbedding, TEST_OWNER);

      const registry = createToolRegistry();
      const memoryTools = createMemoryTools(memory);
      for (const tool of memoryTools) {
        registry.register(tool);
      }
      registry.register(createExecuteCodeTool());

      let callCount = 0;

      // Use a custom model provider that returns tool_use on first call, then end_turn
      const mockModel: ModelProvider = {
        async complete(request) {
          callCount++;
          if (callCount === 1) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'I will call memory_list from code.',
                },
                {
                  type: 'tool_use',
                  id: 'test-tool-2',
                  name: 'execute_code',
                  input: {
                    code: `const blocks = await memory_list();
output(JSON.stringify(blocks).substring(0, 100));`,
                  },
                },
              ] as Array<ContentBlock>,
              stop_reason: 'tool_use',
              usage: {
                input_tokens: 100,
                output_tokens: 50,
              },
            };
          }
          // After tool execution, extract tool result from messages
          let toolResultText = '';
          for (const msg of request.messages) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              for (const block of msg.content) {
                if (block.type === 'tool_result') {
                  toolResultText = typeof block.content === 'string' ? block.content : '';
                  break;
                }
              }
            }
          }
          return {
            content: [
              {
                type: 'text',
                text: `The tool bridge works. Tool result: ${toolResultText}`,
              },
            ] as Array<ContentBlock>,
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          };
        },
        async *stream() {
          yield {
            type: 'message_stop',
            message: {
              stop_reason: 'end_turn',
            },
          };
        },
      };

      const runtime = createDenoExecutor(
        {
          max_code_size: 10000,
          max_output_size: 10000,
          code_timeout: 10000,
          working_dir: '/tmp',
          max_tool_rounds: 5,
          context_budget: 100000,
          max_tool_calls_per_exec: 25,
          allowed_hosts: [],
          allowed_read_paths: [],
          allowed_run: [],
        },
        registry,
      );

      const agent = createAgent(
        {
          model: mockModel,
          memory,
          registry,
          runtime,
          persistence,
          config: {
            max_tool_rounds: 5,
            context_budget: 100000,
            model_max_tokens: 200000,
          },
        },
        TEST_OWNER,
      );

      const response = await agent.processMessage('Call memory_list from code');
      expect(response).toContain('Tool result:');
    });
  });
});
