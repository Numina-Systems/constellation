// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import type { SearchFn, FetchFn, WebToolOptions } from './web.ts';
import { createWebTools } from './web.ts';
import { createToolRegistry } from '../registry.ts';

describe('Built-in web tools', () => {
  function createMockOptions(overrides?: Partial<WebToolOptions>): WebToolOptions {
    const defaultMocks: WebToolOptions = {
      search: async () => ({
        results: [],
        provider: 'mock',
      }),
      fetcher: async () => ({
        url: 'https://example.com',
        title: 'Example',
        content: '# Example',
        total_length: 9,
        offset: 0,
        has_more: false,
      }),
      defaultMaxResults: 10,
    };

    return {
      ...defaultMocks,
      ...overrides,
    };
  }
  describe('web_search and web_fetch tool creation', () => {
    it('should create exactly 2 tools (web_search and web_fetch)', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);

      expect(tools.length).toBe(2);
      const names = tools.map((t) => t.definition.name);
      expect(names).toContain('web_search');
      expect(names).toContain('web_fetch');
    });

    it('should define web_search with correct name and description', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');

      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      expect(webSearch.definition.description).toContain('Search the web');
      expect(webSearch.definition.description).toContain('title, URL, and snippet');
    });

    it('should define web_fetch with correct name and description', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');

      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      expect(webFetch.definition.description).toContain('Fetch a URL');
      expect(webFetch.definition.description).toContain('markdown');
    });

    it('should define web_search with query (required) and limit (optional) parameters', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');

      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      const params = webSearch.definition.parameters;
      expect(params.length).toBe(2);

      const queryParam = params.find((p) => p.name === 'query');
      expect(queryParam).toBeDefined();
      expect(queryParam?.required).toBe(true);
      expect(queryParam?.type).toBe('string');

      const limitParam = params.find((p) => p.name === 'limit');
      expect(limitParam).toBeDefined();
      expect(limitParam?.required).toBe(false);
      expect(limitParam?.type).toBe('number');
      expect(limitParam?.description).toContain('default 10');
    });

    it('should define web_fetch with url (required) and continue_from (optional) parameters', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');

      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      const params = webFetch.definition.parameters;
      expect(params.length).toBe(2);

      const urlParam = params.find((p) => p.name === 'url');
      expect(urlParam).toBeDefined();
      expect(urlParam?.required).toBe(true);
      expect(urlParam?.type).toBe('string');

      const continueParam = params.find((p) => p.name === 'continue_from');
      expect(continueParam).toBeDefined();
      expect(continueParam?.required).toBe(false);
      expect(continueParam?.type).toBe('number');
      expect(continueParam?.description).toContain('paginated');
    });
  });

  describe('web_search handler', () => {
    it('should call search function with query and limit, returning JSON-stringified response', async () => {
      let capturedQuery: string | null = null;
      let capturedLimit: number | null = null;

      const mockSearch: SearchFn = async (query, limit) => {
        capturedQuery = query;
        capturedLimit = limit;
        return {
          results: [
            {
              title: 'Test Result',
              url: 'https://example.com',
              snippet: 'A test search result',
            },
          ],
          provider: 'mock',
        };
      };

      const options = createMockOptions({ search: mockSearch });
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');
      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      const result = await webSearch.handler({ query: 'test query' });

      expect(result.success).toBe(true);
      expect(capturedQuery === 'test query').toBe(true);
      expect(capturedLimit === 10).toBe(true);
      expect(result.output).toContain('Test Result');
      expect(result.output).toContain('https://example.com');
    });

    it('should use defaultMaxResults when limit is not provided', async () => {
      let capturedLimit: number | null = null;

      const mockSearch: SearchFn = async (_query, limit) => {
        capturedLimit = limit;
        return { results: [], provider: 'mock' };
      };

      const options = createMockOptions({ search: mockSearch, defaultMaxResults: 25 });
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');
      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      await webSearch.handler({ query: 'test' });

      expect(capturedLimit === 25).toBe(true);
    });

    it('should override defaultMaxResults when limit parameter is provided', async () => {
      let capturedLimit: number | null = null;

      const mockSearch: SearchFn = async (_query, limit) => {
        capturedLimit = limit;
        return { results: [], provider: 'mock' };
      };

      const options = createMockOptions({ search: mockSearch });
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');
      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      await webSearch.handler({ query: 'test', limit: 5 });

      expect(capturedLimit === 5).toBe(true);
    });

    it('should catch errors and return success: false with error message', async () => {
      const mockSearch: SearchFn = async () => {
        throw new Error('Search provider error');
      };

      const options = createMockOptions({ search: mockSearch });
      const tools = createWebTools(options);
      const webSearch = tools.find((t) => t.definition.name === 'web_search');
      expect(webSearch).toBeDefined();
      if (!webSearch) return;

      const result = await webSearch.handler({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.error).toContain('web search failed');
      expect(result.error).toContain('Search provider error');
    });
  });

  describe('web_fetch handler', () => {
    it('should call fetcher with url and offset, returning JSON-stringified result', async () => {
      let capturedUrl: string | null = null;
      let capturedOffset: number | null = null;

      const mockFetcher: FetchFn = async (url, offset) => {
        capturedUrl = url;
        capturedOffset = offset ?? 0;
        return {
          url,
          title: 'Test Page',
          content: '# Test\n\nSome content',
          total_length: 22,
          offset: capturedOffset,
          has_more: false,
        };
      };

      const options = createMockOptions({ fetcher: mockFetcher });
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');
      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      const result = await webFetch.handler({ url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(capturedUrl === 'https://example.com').toBe(true);
      expect(capturedOffset === 0).toBe(true);
      expect(result.output).toContain('Test Page');
      expect(result.output).toContain('# Test');
    });

    it('should use offset 0 when continue_from is not provided', async () => {
      let capturedOffset: number | null = null;

      const mockFetcher: FetchFn = async (url, offset) => {
        capturedOffset = offset ?? 0;
        return {
          url,
          title: 'Example',
          content: '# Example',
          total_length: 9,
          offset: capturedOffset,
          has_more: false,
        };
      };

      const options = createMockOptions({ fetcher: mockFetcher });
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');
      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      await webFetch.handler({ url: 'https://example.com' });

      expect(capturedOffset === 0).toBe(true);
    });

    it('should pass continue_from as offset when provided', async () => {
      let capturedOffset: number | null = null;

      const mockFetcher: FetchFn = async (url, offset) => {
        capturedOffset = offset ?? 0;
        return {
          url,
          title: 'Example',
          content: 'Content part 2',
          total_length: 1000,
          offset: capturedOffset,
          has_more: true,
        };
      };

      const options = createMockOptions({ fetcher: mockFetcher });
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');
      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      await webFetch.handler({ url: 'https://example.com', continue_from: 500 });

      expect(capturedOffset === 500).toBe(true);
    });

    it('should catch errors and return success: false with error message', async () => {
      const mockFetcher: FetchFn = async () => {
        throw new Error('Network timeout');
      };

      const options = createMockOptions({ fetcher: mockFetcher });
      const tools = createWebTools(options);
      const webFetch = tools.find((t) => t.definition.name === 'web_fetch');
      expect(webFetch).toBeDefined();
      if (!webFetch) return;

      const result = await webFetch.handler({ url: 'https://example.com' });

      expect(result.success).toBe(false);
      expect(result.output).toBe('');
      expect(result.error).toContain('web fetch failed');
      expect(result.error).toContain('Network timeout');
    });
  });

  describe('AC4.1: Registry integration', () => {
    it('should register web_search and web_fetch in createToolRegistry and appear in getDefinitions', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const registry = createToolRegistry();

      for (const tool of tools) {
        registry.register(tool);
      }

      const definitions = registry.getDefinitions();
      expect(definitions.length).toBe(2);

      const names = definitions.map((d) => d.name);
      expect(names).toContain('web_search');
      expect(names).toContain('web_fetch');
    });

    it('should have correct descriptions and parameters in registry definitions', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const registry = createToolRegistry();

      for (const tool of tools) {
        registry.register(tool);
      }

      const definitions = registry.getDefinitions();
      const webSearchDef = definitions.find((d) => d.name === 'web_search');
      const webFetchDef = definitions.find((d) => d.name === 'web_fetch');

      expect(webSearchDef).toBeDefined();
      expect(webSearchDef?.description).toContain('Search the web');
      expect(webSearchDef?.parameters.length).toBe(2);

      expect(webFetchDef).toBeDefined();
      expect(webFetchDef?.description).toContain('Fetch a URL');
      expect(webFetchDef?.parameters.length).toBe(2);
    });
  });

  describe('AC4.3: IPC bridge stub generation', () => {
    it('should generate stubs with correct function names and parameter signatures', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const registry = createToolRegistry();

      for (const tool of tools) {
        registry.register(tool);
      }

      const stubs = registry.generateStubs();

      expect(stubs).toContain('async function web_search');
      expect(stubs).toContain('async function web_fetch');
      expect(stubs).toContain('__callTool__("web_search"');
      expect(stubs).toContain('__callTool__("web_fetch"');
    });

    it('should generate web_search stub with query (required) and limit (optional) parameters', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const registry = createToolRegistry();

      for (const tool of tools) {
        registry.register(tool);
      }

      const stubs = registry.generateStubs();

      expect(stubs).toContain('query: string');
      expect(stubs).toContain('limit?: number');
    });

    it('should generate web_fetch stub with url (required) and continue_from (optional) parameters', () => {
      const options = createMockOptions();
      const tools = createWebTools(options);
      const registry = createToolRegistry();

      for (const tool of tools) {
        registry.register(tool);
      }

      const stubs = registry.generateStubs();

      expect(stubs).toContain('url: string');
      expect(stubs).toContain('continue_from?: number');
    });
  });
});
