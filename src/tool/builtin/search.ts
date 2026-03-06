// pattern: Imperative Shell

/**
 * Built-in search tool for unified search across memory and conversation domains.
 * Supports hybrid, keyword, and semantic search modes with domain and time filtering.
 */

import type { Tool } from '../types.ts';
import type { SearchStore, SearchDomainName, SearchResult } from '../../search/index.ts';

export function createSearchTools(searchStore: SearchStore): Array<Tool> {
  const search: Tool = {
    definition: {
      name: 'search',
      description:
        'Search across memory blocks and conversations using hybrid search (combining keyword and semantic similarity), pure keyword matching, or pure semantic similarity. Supports filtering by domain, time range, memory tier, and conversation role.',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query text',
          required: true,
        },
        {
          name: 'mode',
          type: 'string',
          description: 'Search mode: semantic (vector similarity), keyword (exact term matching), or hybrid (combined). Default: hybrid',
          required: false,
          enum_values: ['semantic', 'keyword', 'hybrid'],
        },
        {
          name: 'domain',
          type: 'string',
          description: 'Search domain: memory (memory blocks), conversations (chat messages), or all (both). Default: all',
          required: false,
          enum_values: ['memory', 'conversations', 'all'],
        },
        {
          name: 'limit',
          type: 'number',
          description: 'Maximum number of results to return. Clamped to 1-50 range. Default: 10',
          required: false,
        },
        {
          name: 'start_time',
          type: 'string',
          description: 'ISO 8601 timestamp to filter results created after this time (inclusive)',
          required: false,
        },
        {
          name: 'end_time',
          type: 'string',
          description: 'ISO 8601 timestamp to filter results created before this time (inclusive)',
          required: false,
        },
        {
          name: 'role',
          type: 'string',
          description: 'Filter conversation results by message role (applies only to conversations domain)',
          required: false,
          enum_values: ['user', 'assistant', 'system', 'tool'],
        },
        {
          name: 'tier',
          type: 'string',
          description: 'Filter memory results by tier (applies only to memory domain)',
          required: false,
          enum_values: ['core', 'working', 'archival'],
        },
      ],
    },
    handler: async (params) => {
      try {
        // Extract parameters with defaults
        const query = params['query'] as string;
        const mode = (params['mode'] as string | undefined) ?? 'hybrid';
        const domain = (params['domain'] as string | undefined) ?? 'all';
        let limit = (params['limit'] as number | undefined) ?? 10;
        const startTimeStr = params['start_time'] as string | undefined;
        const endTimeStr = params['end_time'] as string | undefined;
        const role = params['role'] as string | undefined;
        const tier = params['tier'] as string | undefined;

        // Clamp limit to 1-50 range
        limit = Math.max(1, Math.min(50, limit));

        // Resolve domain: 'all' to ['memory', 'conversations']
        const domains: ReadonlyArray<SearchDomainName> =
          domain === 'all' ? ['memory', 'conversations'] : ([domain] as ReadonlyArray<SearchDomainName>);

        // Parse ISO 8601 timestamps
        const startTime = startTimeStr ? new Date(startTimeStr) : null;
        const endTime = endTimeStr ? new Date(endTimeStr) : null;

        // Build SearchParams and call searchStore.search()
        const results = await searchStore.search({
          query,
          mode: mode as 'semantic' | 'keyword' | 'hybrid',
          domains,
          embedding: null,
          limit,
          startTime,
          endTime,
          role: role ?? null,
          tier: tier ?? null,
        });

        // Format results: truncate content to 500 chars
        const formatted = results.map((result: SearchResult) => ({
          domain: result.domain,
          id: result.id,
          content: result.content.length > 500 ? result.content.substring(0, 500) + '...' : result.content,
          score: result.score,
          metadata: result.metadata,
          created_at: result.createdAt.toISOString(),
        }));

        return {
          success: true,
          output: JSON.stringify(formatted, null, 2),
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  return [search];
}
