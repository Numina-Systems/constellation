// pattern: Imperative Shell

/**
 * Built-in web tools for searching and fetching web content.
 * These tools delegate to the search chain and fetcher functions.
 */

import type { Tool } from '../types.ts';
import type { SearchResponse, FetchResult } from '../../web/types.ts';

type SearchFn = (query: string, limit: number) => Promise<SearchResponse>;
type FetchFn = (url: string, offset?: number) => Promise<FetchResult>;

type WebToolOptions = {
  readonly search: SearchFn;
  readonly fetcher: FetchFn;
  readonly defaultMaxResults: number;
};

export function createWebTools(
  options: WebToolOptions,
): Array<Tool> {
  const { search, fetcher, defaultMaxResults } = options;

  const web_search: Tool = {
    definition: {
      name: 'web_search',
      description: 'Search the web and return structured results with title, URL, and snippet for each result.',
      parameters: [
        {
          name: 'query',
          type: 'string',
          description: 'Search query',
          required: true,
        },
        {
          name: 'limit',
          type: 'number',
          description: `Maximum number of results to return (default ${defaultMaxResults})`,
          required: false,
        },
      ],
    },
    handler: async (params) => {
      const query = params['query'] as string;
      const limit = (params['limit'] as number | undefined) ?? defaultMaxResults;

      try {
        const response = await search(query, limit);
        return {
          success: true,
          output: JSON.stringify(response, null, 2),
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `web search failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  const web_fetch: Tool = {
    definition: {
      name: 'web_fetch',
      description: 'Fetch a URL and return its content as clean markdown. Supports pagination for large pages via continue_from offset.',
      parameters: [
        {
          name: 'url',
          type: 'string',
          description: 'URL to fetch',
          required: true,
        },
        {
          name: 'continue_from',
          type: 'number',
          description: 'Character offset to continue reading from (for paginated content)',
          required: false,
        },
      ],
    },
    handler: async (params) => {
      const url = params['url'] as string;
      const continueFrom = (params['continue_from'] as number | undefined) ?? 0;

      try {
        const result = await fetcher(url, continueFrom);
        return {
          success: true,
          output: JSON.stringify(result, null, 2),
        };
      } catch (err) {
        return {
          success: false,
          output: '',
          error: `web fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };

  return [web_search, web_fetch];
}
