// pattern: Imperative Shell

/**
 * Built-in memory tools for semantic search, write, and list operations.
 * These tools delegate to the MemoryManager port interface.
 */

import type { MemoryManager } from '../../memory/index.ts';
import type { Tool } from '../types.ts';

export function createMemoryTools(manager: MemoryManager): Array<Tool> {
  const memory_read: Tool = {
    definition: {
      name: 'memory_read',
      description:
        'Search memory by semantic similarity. Returns matching memory blocks ranked by relevance.',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query for semantic similarity',
          required: true,
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of results to return',
          required: false,
          enum_values: undefined,
        },
        {
          name: 'tier',
          type: 'string',
          description: 'Memory tier to search within',
          required: false,
          enum_values: ['core', 'working', 'archival'],
        },
      ],
    },
    handler: async (params) => {
      const query = params['query'] as string;
      const limit = (params['limit'] as number | undefined) ?? 5;
      const tier = params['tier'] as string | undefined;

      const results = await manager.read(query, limit, tier as any);

      const formatted = results.map((result) => ({
        id: result.block.id,
        label: result.block.label,
        content: result.block.content,
        similarity: result.similarity.toFixed(3),
        tier: result.block.tier,
        permission: result.block.permission,
      }));

      return {
        success: true,
        output: JSON.stringify(formatted, null, 2),
      };
    },
  };

  const memory_write: Tool = {
    definition: {
      name: 'memory_write',
      description: 'Write or update a memory block. Some blocks require familiar approval.',
      parameters: [
        {
          name: 'label',
          type: 'string',
          description: 'Label for the memory block',
          required: true,
        },
        {
          name: 'content',
          type: 'string',
          description: 'Content to store',
          required: true,
        },
        {
          name: 'tier',
          type: 'string',
          description: 'Memory tier for storage',
          required: false,
          enum_values: ['core', 'working', 'archival'],
        },
        {
          name: 'reason',
          type: 'string',
          description: 'Reason for the write (for familiar blocks)',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      const label = params['label'] as string;
      const content = params['content'] as string;
      const tier = params['tier'] as string | undefined;
      const reason = params['reason'] as string | undefined;

      const result = await manager.write(label, content, tier as any, reason);

      if ('error' in result && result.error) {
        return {
          success: false,
          output: '',
          error: result.error,
        };
      }

      if ('mutation' in result && !result.applied) {
        const mutationFormatted = {
          id: result.mutation.id,
          status: result.mutation.status,
          proposed_content: result.mutation.proposed_content,
          reason: result.mutation.reason,
        };
        return {
          success: true,
          output: `mutation queued for familiar approval: ${JSON.stringify(mutationFormatted)}`,
        };
      }

      if ('block' in result && result.applied) {
        const blockFormatted = {
          id: result.block.id,
          label: result.block.label,
          tier: result.block.tier,
          permission: result.block.permission,
          created_at: result.block.created_at.toISOString(),
        };
        return {
          success: true,
          output: `memory written: ${JSON.stringify(blockFormatted)}`,
        };
      }

      return {
        success: false,
        output: '',
        error: 'unexpected write result',
      };
    },
  };

  const memory_list: Tool = {
    definition: {
      name: 'memory_list',
      description: 'List memory blocks, optionally filtered by tier.',
      parameters: [
        {
          name: 'tier',
          type: 'string',
          description: 'Memory tier to filter by',
          required: false,
          enum_values: ['core', 'working', 'archival'],
        },
      ],
    },
    handler: async (params) => {
      const tier = params['tier'] as string | undefined;

      const blocks = await manager.list(tier as any);

      const formatted = blocks.map((block) => ({
        id: block.id,
        label: block.label,
        tier: block.tier,
        permission: block.permission,
        preview: block.content.substring(0, 100) + (block.content.length > 100 ? '...' : ''),
      }));

      return {
        success: true,
        output: JSON.stringify(formatted, null, 2),
      };
    },
  };

  return [memory_read, memory_write, memory_list];
}
