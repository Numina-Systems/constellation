// pattern: Functional Core (tests for provider factory and namespacing)

import { describe, it, expect, beforeEach } from 'bun:test';
import type { McpClient, McpToolInfo } from './types.js';
import type { ToolResult } from '@/tool/types.js';
import { createMcpToolProvider, namespaceTool } from './provider.js';

describe('namespaceTool', () => {
  describe('mcp-client.AC4.1: Tool namespacing', () => {
    it('should namespace tools with basic names', () => {
      const result = namespaceTool('github', 'create_issue');
      expect(result).toBe('mcp_github_create_issue');
    });

    it('should convert hyphens to underscores in server name', () => {
      const result = namespaceTool('my-server', 'list-files');
      expect(result).toBe('mcp_my_server_list_files');
    });

    it('should convert hyphens to underscores in tool name', () => {
      const result = namespaceTool('github', 'list-pull-requests');
      expect(result).toBe('mcp_github_list_pull_requests');
    });

    it('should convert hyphens in both server and tool names', () => {
      const result = namespaceTool('my-server', 'list-files');
      expect(result).toBe('mcp_my_server_list_files');
    });
  });
});

describe('createMcpToolProvider', () => {
  let mockClient: McpClient;

  beforeEach(() => {
    mockClient = createMockMcpClient();
  });

  describe('mcp-client.AC4.1, AC4.3: Name mapping and dispatch', () => {
    it('should populate name map during discover and use it during execute', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: 'Search files',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ];

      mockClient = createMockMcpClient({ tools: mockTools });
      const provider = createMcpToolProvider(mockClient);

      // Discover to populate name map
      await provider.discover();

      // Execute with namespaced name
      const callToolResult: ToolResult = {
        success: true,
        output: 'results',
      };
      mockClient = createMockMcpClient({
        tools: mockTools,
        callToolResult,
      });
      const provider2 = createMcpToolProvider(mockClient);
      await provider2.discover();

      const result = await provider2.execute('mcp_test_server_search', {
        query: 'foo',
      });

      expect(result).toEqual(callToolResult);
    });

    it('should return error for unknown tool during execute', async () => {
      const provider = createMcpToolProvider(mockClient);

      const result = await provider.execute('mcp_unknown_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown MCP tool');
    });
  });

  describe('mcp-client.AC4.1, AC4.2, AC4.3: discover() and execute()', () => {
    it('should namespace tools correctly during discover', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: 'Search files',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
            required: ['query'],
          },
        },
      ];

      mockClient = createMockMcpClient({ tools: mockTools });
      const provider = createMcpToolProvider(mockClient);

      const definitions = await provider.discover();

      expect(definitions).toHaveLength(1);
      expect(definitions[0]?.name).toBe('mcp_test_server_search');
    });

    it('should prefix descriptions with MCP server name', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: 'Search files',
          inputSchema: { type: 'object' },
        },
      ];

      mockClient = createMockMcpClient({ tools: mockTools });
      const provider = createMcpToolProvider(mockClient);

      const definitions = await provider.discover();

      expect(definitions[0]?.description).toBe('[MCP: test-server] Search files');
    });

    it('should handle undefined tool description', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: undefined,
          inputSchema: { type: 'object' },
        },
      ];

      mockClient = createMockMcpClient({ tools: mockTools });
      const provider = createMcpToolProvider(mockClient);

      const definitions = await provider.discover();

      expect(definitions[0]?.description).toBe('[MCP: test-server] ');
    });

    it('should dispatch to callTool with original tool name', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: 'Search files',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string' },
            },
          },
        },
      ];

      const callToolResult: ToolResult = {
        success: true,
        output: 'found results',
      };

      mockClient = createMockMcpClient({
        tools: mockTools,
        callToolResult,
      });
      const provider = createMcpToolProvider(mockClient);

      await provider.discover();
      const result = await provider.execute('mcp_test_server_search', {
        query: 'foo',
      });

      expect(result).toEqual(callToolResult);
    });

    it('should discover multiple tools with correct namespacing', async () => {
      const mockTools: Array<McpToolInfo> = [
        {
          name: 'search',
          description: 'Search files',
          inputSchema: { type: 'object' },
        },
        {
          name: 'list-files',
          description: 'List files',
          inputSchema: { type: 'object' },
        },
        {
          name: 'read_file',
          description: 'Read file contents',
          inputSchema: { type: 'object' },
        },
      ];

      mockClient = createMockMcpClient({ tools: mockTools });
      const provider = createMcpToolProvider(mockClient);

      const definitions = await provider.discover();

      expect(definitions).toHaveLength(3);
      expect(definitions[0]?.name).toBe('mcp_test_server_search');
      expect(definitions[1]?.name).toBe('mcp_test_server_list_files');
      expect(definitions[2]?.name).toBe('mcp_test_server_read_file');
    });
  });
});

/**
 * Mock MCP client for testing
 */
function createMockMcpClient(options?: {
  tools?: Array<McpToolInfo>;
  callToolResult?: ToolResult;
}): McpClient {
  const tools = options?.tools ?? [];
  const callToolResult = options?.callToolResult ?? {
    success: true,
    output: 'mock response',
  };

  return {
    serverName: 'test-server',
    async connect() {
      // Mock implementation
    },
    async disconnect() {
      // Mock implementation
    },
    async listTools() {
      return tools;
    },
    async callTool(_name: string, _args: Record<string, unknown>) {
      return callToolResult;
    },
    async listPrompts() {
      return [];
    },
    async getPrompt(_name: string, _args?: Record<string, string>) {
      return { description: undefined, messages: [] };
    },
    async getInstructions() {
      return undefined;
    },
  };
}
