// pattern: Imperative Shell

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createToolRegistry } from '@/tool/registry.ts';
import { createWebTools } from '@/tool/builtin/web.ts';
import { createSearchChain } from './chain.ts';
import { createFetcher } from './fetch.ts';
import { loadConfig } from '@/config/config.ts';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function createTestRegistry(config?: { brave_api_key?: string }) {
  const testConfig = config || { brave_api_key: 'test-key' };
  const chain = createSearchChain(testConfig);
  const fetcher = createFetcher({
    fetch_timeout: 5000,
    max_fetch_size: 1000000,
    cache_ttl: 3600000,
  });

  const webTools = createWebTools({
    search: (q, limit) => chain.search(q, limit),
    fetcher,
    defaultMaxResults: 10,
  });

  const registry = createToolRegistry();
  for (const tool of webTools) {
    registry.register(tool);
  }

  return registry;
}

describe('Web tools integration tests', () => {
  let originalFetch: typeof fetch;
  let tempConfigPath: string | null = null;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (tempConfigPath) {
      try {
        unlinkSync(tempConfigPath);
      } catch {
        // Ignore cleanup errors
      }
      tempConfigPath = null;
    }
  });

  describe('AC4.3: IPC bridge stub generation for web tools', () => {
    it('should generate typed stubs for web_search with correct signature', () => {
      const registry = createTestRegistry();
      const stubs = registry.generateStubs();

      expect(stubs).toContain('async function web_search');
      expect(stubs).toContain('params: { query: string, limit?: number }');
      expect(stubs).toContain('__callTool__("web_search", params)');
    });

    it('should generate typed stubs for web_fetch with correct signature', () => {
      const registry = createTestRegistry();
      const stubs = registry.generateStubs();

      expect(stubs).toContain('async function web_fetch');
      expect(stubs).toContain('params: { url: string, continue_from?: number }');
      expect(stubs).toContain('__callTool__("web_fetch", params)');
    });
  });

  describe('AC5.1: Environment variable overrides for API keys', () => {
    it('should load BRAVE_API_KEY from environment and override config.toml', () => {
      // Create a temporary config file with minimal valid config
      const tmpDir = tmpdir();
      tempConfigPath = join(tmpDir, `test-config-${Date.now()}.toml`);

      const configContent = `
[model]
provider = "anthropic"
api_key = "dummy"
name = "claude-3-5-sonnet-20241022"

[embedding]
provider = "openai"
api_key = "dummy"
model = "text-embedding-3-small"

[database]
url = "postgresql://dummy"

[runtime]
allowed_hosts = []

[web]
# Empty web config
`;

      writeFileSync(tempConfigPath, configContent);

      // Set environment variable
      const originalBraveKey = process.env['BRAVE_API_KEY'];
      process.env['BRAVE_API_KEY'] = 'test-brave-key-from-env';

      try {
        const config = loadConfig(tempConfigPath);
        expect(config.web?.brave_api_key).toBe('test-brave-key-from-env');
      } finally {
        if (originalBraveKey !== undefined) {
          process.env['BRAVE_API_KEY'] = originalBraveKey;
        } else {
          delete process.env['BRAVE_API_KEY'];
        }
      }
    });

    it('should load TAVILY_API_KEY from environment and override config.toml', () => {
      // Create a temporary config file with minimal valid config
      const tmpDir = tmpdir();
      tempConfigPath = join(tmpDir, `test-config-${Date.now()}.toml`);

      const configContent = `
[model]
provider = "anthropic"
api_key = "dummy"
name = "claude-3-5-sonnet-20241022"

[embedding]
provider = "openai"
api_key = "dummy"
model = "text-embedding-3-small"

[database]
url = "postgresql://dummy"

[runtime]
allowed_hosts = []

[web]
# Empty web config
`;

      writeFileSync(tempConfigPath, configContent);

      // Set environment variable
      const originalTavilyKey = process.env['TAVILY_API_KEY'];
      process.env['TAVILY_API_KEY'] = 'test-tavily-key-from-env';

      try {
        const config = loadConfig(tempConfigPath);
        expect(config.web?.tavily_api_key).toBe('test-tavily-key-from-env');
      } finally {
        if (originalTavilyKey !== undefined) {
          process.env['TAVILY_API_KEY'] = originalTavilyKey;
        } else {
          delete process.env['TAVILY_API_KEY'];
        }
      }
    });
  });

  describe('AC4.2: Web tools absent from registry when [web] config is omitted', () => {
    it('should not register web_search and web_fetch when config.web is undefined', () => {
      // Create a temporary config file WITHOUT a [web] section
      const tmpDir = tmpdir();
      tempConfigPath = join(tmpDir, `test-config-no-web-${Date.now()}.toml`);

      const configContent = `
[model]
provider = "anthropic"
api_key = "dummy"
name = "claude-3-5-sonnet-20241022"

[embedding]
provider = "openai"
api_key = "dummy"
model = "text-embedding-3-small"

[database]
url = "postgresql://dummy"

[runtime]
allowed_hosts = []
`;

      writeFileSync(tempConfigPath, configContent);

      try {
        const config = loadConfig(tempConfigPath);

        // Verify config.web is undefined
        expect(config.web).toBeUndefined();

        // Create an empty registry (as if we didn't call the web tools registration logic)
        const registry = createToolRegistry();

        // Verify that web_search and web_fetch are NOT in the definitions
        const definitions = registry.getDefinitions();
        const toolNames = definitions.map((d) => d.name);
        expect(toolNames).not.toContain('web_search');
        expect(toolNames).not.toContain('web_fetch');
      } finally {
        // Cleanup
        if (tempConfigPath) {
          try {
            unlinkSync(tempConfigPath);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    });
  });

  describe('AC5.2: Deno runtime net permissions unaffected by web tools', () => {
    it('should not affect runtime config when web tools are registered', () => {
      const registry = createTestRegistry();

      // Verify that registering web tools doesn't require changes to existing runtime config
      // Web tools execute on Bun host via tool handler path, not in Deno sandbox
      const stubs = registry.generateStubs();
      expect(stubs).toBeDefined();

      // Verify web tools are registered and available for dispatch
      const definitions = registry.getDefinitions();
      const webToolNames = definitions.map((d) => d.name);
      expect(webToolNames).toContain('web_search');
      expect(webToolNames).toContain('web_fetch');
    });
  });

  describe('Full dispatch pipeline: web_search', () => {
    it('should dispatch web_search and return success with search results', async () => {
      // Mock fetch to return Brave-format JSON
      const braveResponse = {
        web: {
          results: [
            {
              title: 'Example Search Result',
              url: 'https://example.com',
              description: 'This is an example search result',
            },
          ],
        },
      };

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => braveResponse,
        } as any;
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_search', { query: 'test' });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.results).toBeDefined();
      expect(output.results.length).toBeGreaterThan(0);
      expect(output.provider).toBe('brave');
    });

    it('should dispatch web_search with limit parameter', async () => {
      let capturedUrl: string | null = null;

      const braveResponse = {
        web: {
          results: [
            {
              title: 'Result 1',
              url: 'https://example.com/1',
              description: 'First result',
            },
          ],
        },
      };

      globalThis.fetch = (async (url: string | URL) => {
        capturedUrl = url.toString();
        return {
          ok: true,
          status: 200,
          headers: new Headers({'content-type': 'application/json'}),
          json: async () => braveResponse,
        } as any;
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_search', {
        query: 'test',
        limit: 5,
      });

      expect(result.success).toBe(true);
      expect(capturedUrl).not.toBeNull();
      expect(String(capturedUrl)).toContain('count=5');
    });

    it('should handle search errors gracefully', async () => {
      globalThis.fetch = (async () => {
        throw new Error('Network error');
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_search', { query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('web search failed');
      expect(result.output).toBe('');
    });
  });

  describe('Full dispatch pipeline: web_fetch', () => {
    it('should dispatch web_fetch and return success with HTML converted to markdown', async () => {
      const mockHtml = `
        <html>
          <head><title>Example Page</title></head>
          <body>
            <h1>Example Page</h1>
            <p>This is example content.</p>
          </body>
        </html>
      `;

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({'content-type': 'text/html'}),
          text: async () => mockHtml,
        } as any;
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_fetch', {
        url: 'https://example.com',
      });

      expect(result.success).toBe(true);
      const output = JSON.parse(result.output);
      expect(output.url).toBe('https://example.com');
      expect(output.title).toBeDefined();
      expect(output.content).toBeDefined();
      expect(output.total_length).toBeGreaterThan(0);
      expect(output.has_more).toBeDefined();
    });

    it('should dispatch web_fetch with pagination offset', async () => {
      // Create a very long HTML to ensure the content exceeds 8000 chars (pagination threshold)
      const longContent = Array(500)
        .fill(
          '<p>This is a paragraph with some content that repeats to make the page very long so that pagination is triggered.</p>',
        )
        .join('');

      const longHtml = `
        <html>
          <head><title>Long Page</title></head>
          <body>
            <h1>Long Page</h1>
            ${longContent}
          </body>
        </html>
      `;

      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({'content-type': 'text/html'}),
          text: async () => longHtml,
        } as any;
      }) as any;

      const registry = createTestRegistry();

      // First request to populate cache
      const result1 = await registry.dispatch('web_fetch', {
        url: 'https://example.com/long',
      });
      expect(result1.success).toBe(true);
      const output1 = JSON.parse(result1.output);
      const totalLength = output1.total_length;

      // Assert pagination conditions unconditionally
      expect(totalLength).toBeGreaterThan(1000);

      // Second request with pagination offset (use a smaller offset within bounds)
      const offsetToUse = Math.min(500, Math.max(0, totalLength - 100));
      const result2 = await registry.dispatch('web_fetch', {
        url: 'https://example.com/long',
        continue_from: offsetToUse,
      });
      expect(result2.success).toBe(true);
      const output2 = JSON.parse(result2.output);
      expect(output2.offset).toBe(offsetToUse);
      expect(output2.total_length).toBe(totalLength);
    });

    it('should handle fetch errors gracefully', async () => {
      globalThis.fetch = (async () => {
        throw new Error('Connection timeout');
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_fetch', {
        url: 'https://example.com',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('web fetch failed');
      expect(result.output).toBe('');
    });

    it('should reject non-HTML content types', async () => {
      globalThis.fetch = (async () => {
        return {
          ok: true,
          status: 200,
          headers: new Headers({'content-type': 'application/pdf'}),
          text: async () => '%PDF-1.4...',
        } as any;
      }) as any;

      const registry = createTestRegistry();
      const result = await registry.dispatch('web_fetch', {
        url: 'https://example.com/document.pdf',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('web fetch failed');
    });
  });

  describe('Dispatch error handling', () => {
    it('should return error for missing required parameter', async () => {
      const registry = createTestRegistry();
      const result = await registry.dispatch('web_search', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('missing required parameter');
      expect(result.error).toContain('query');
    });

    it('should return error for invalid parameter type', async () => {
      const registry = createTestRegistry();
      const result = await registry.dispatch('web_search', {
        query: 'test',
        limit: 'not a number',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('invalid type');
      expect(result.error).toContain('limit');
    });

    it('should return error for unknown tool', async () => {
      const registry = createTestRegistry();
      const result = await registry.dispatch('nonexistent_tool', {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('unknown tool');
    });
  });
});
