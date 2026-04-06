// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { ZodError } from 'zod';
import { AppConfigSchema } from '@/config/schema.ts';
import { McpConfigSchema, McpServerConfigSchema } from './schema.ts';

describe('mcp-client.AC1: MCP config schema validation', () => {
  describe('mcp-client.AC1.1: Stdio server config with command, args, and env parses correctly', () => {
    it('should parse a stdio server config with all fields present', () => {
      const config = {
        transport: 'stdio',
        command: 'mcp-cli',
        args: ['--verbose', '--port=8080'],
        env: { DEBUG: 'true', PATH: '/usr/bin' },
      };

      const result = McpServerConfigSchema.parse(config);

      expect(result.transport).toBe('stdio');
      // Use type guard to safely access stdio-specific properties
      if (result.transport === 'stdio') {
        expect(result.command).toBe('mcp-cli');
        expect(result.args).toContain('--verbose');
        expect(result.args).toContain('--port=8080');
        expect(result.env['DEBUG']).toBe('true');
        expect(result.env['PATH']).toBe('/usr/bin');
      }
    });

    it('should parse stdio config with empty args and env (defaults)', () => {
      const config = {
        transport: 'stdio',
        command: 'mcp-cli',
      };

      const result = McpServerConfigSchema.parse(config);

      expect(result.transport).toBe('stdio');
      if (result.transport === 'stdio') {
        expect(result.command).toBe('mcp-cli');
        expect(result.args.length).toBe(0);
        expect(Object.keys(result.env).length).toBe(0);
      }
    });
  });

  describe('mcp-client.AC1.2: HTTP server config with url parses correctly', () => {
    it('should parse an HTTP server config with valid url', () => {
      const config = {
        transport: 'http',
        url: 'https://mcp-server.example.com:9000/api',
      };

      const result = McpServerConfigSchema.parse(config);

      expect(result.transport).toBe('http');
      if (result.transport === 'http') {
        expect(result.url).toBe('https://mcp-server.example.com:9000/api');
      }
    });

    it('should parse HTTP config with localhost url', () => {
      const config = {
        transport: 'http',
        url: 'http://localhost:8080',
      };

      const result = McpServerConfigSchema.parse(config);

      expect(result.transport).toBe('http');
      if (result.transport === 'http') {
        expect(result.url).toBe('http://localhost:8080');
      }
    });
  });

  describe('mcp-client.AC1.3: Multiple servers of mixed transport types parse correctly', () => {
    it('should parse config with multiple servers of mixed types', () => {
      const config = {
        enabled: true,
        servers: {
          'server-stdio': {
            transport: 'stdio',
            command: 'stdio-mcp',
            args: ['--mode=test'],
            env: {},
          },
          'server-http': {
            transport: 'http',
            url: 'https://api.example.com',
          },
          'another-stdio': {
            transport: 'stdio',
            command: 'another-mcp',
          },
        },
      };

      const result = McpConfigSchema.parse(config);

      expect(result.enabled).toBe(true);
      expect(result.servers['server-stdio']?.transport).toBe('stdio');
      expect(result.servers['server-http']?.transport).toBe('http');
      expect(result.servers['another-stdio']?.transport).toBe('stdio');
      expect(Object.keys(result.servers).length).toBe(3);
    });
  });

  describe('mcp-client.AC1.4: Stdio config missing command is rejected', () => {
    it('should fail validation when stdio config lacks command field', () => {
      const config = {
        transport: 'stdio',
        args: ['--verbose'],
        env: {},
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });

    it('should fail validation when command is empty string', () => {
      const config = {
        transport: 'stdio',
        command: '',
        args: [],
        env: {},
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });
  });

  describe('mcp-client.AC1.5: HTTP config missing url is rejected', () => {
    it('should fail validation when http config lacks url field', () => {
      const config = {
        transport: 'http',
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });

    it('should fail validation when url is invalid', () => {
      const config = {
        transport: 'http',
        url: 'not-a-valid-url',
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });
  });

  describe('mcp-client.AC1.6: Unknown transport type is rejected', () => {
    it('should fail validation when transport is websocket (unknown)', () => {
      const config = {
        transport: 'websocket',
        url: 'wss://server.example.com',
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });

    it('should fail validation when transport is ssh (unknown)', () => {
      const config = {
        transport: 'ssh',
        host: 'server.example.com',
      };

      expect(() => McpServerConfigSchema.parse(config)).toThrow(ZodError);
    });
  });

  describe('mcp-client.AC1.7: Empty servers map with enabled=true is valid', () => {
    it('should parse config with enabled:true and empty servers map', () => {
      const config = {
        enabled: true,
        servers: {},
      };

      const result = McpConfigSchema.parse(config);

      expect(result.enabled).toBe(true);
      expect(Object.keys(result.servers).length).toBe(0);
    });

    it('should parse config with no mcp field (defaults to enabled:false, empty servers)', () => {
      // Intentionally untyped to test default parsing behaviour
      const config: Record<string, unknown> = {};

      const result = McpConfigSchema.parse(config);

      expect(result.enabled).toBe(false);
      expect(Object.keys(result.servers).length).toBe(0);
    });
  });

  describe('mcp-client.AC1.8: Env vars with ${VAR} syntax are expanded from process.env', () => {
    it('should be compatible with string interpolation (expansion tested separately in env.test.ts)', () => {
      const config = {
        enabled: true,
        servers: {
          'test-server': {
            transport: 'stdio',
            command: 'mcp-cli',
            args: [],
            env: { API_KEY: 'secret-value' },
          },
        },
      };

      const result = McpConfigSchema.parse(config);

      expect(result.enabled).toBe(true);
      const testServer = result.servers['test-server'];
      expect(testServer?.transport).toBe('stdio');
      if (testServer?.transport === 'stdio') {
        expect(testServer.env['API_KEY']).toBe('secret-value');
      }
    });
  });

  describe('Integration: MCP config in AppConfigSchema', () => {
    it('should parse AppConfig with mcp field present', () => {
      const config = {
        agent: {},
        model: { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' },
        embedding: { provider: 'openai', model: 'text-embedding-3-small' },
        database: { url: 'postgresql://localhost/test' },
        runtime: {},
        mcp: {
          enabled: true,
          servers: {
            'test-server': {
              transport: 'stdio',
              command: 'test-mcp',
            },
          },
        },
      };

      const result = AppConfigSchema.parse(config);

      expect(result.mcp.enabled).toBe(true);
      expect(result.mcp.servers['test-server']?.transport).toBe('stdio');
    });

    it('should apply mcp defaults when field is absent from AppConfig', () => {
      const config = {
        agent: {},
        model: { provider: 'anthropic', name: 'claude-3-5-sonnet-20241022' },
        embedding: { provider: 'openai', model: 'text-embedding-3-small' },
        database: { url: 'postgresql://localhost/test' },
        runtime: {},
      };

      const result = AppConfigSchema.parse(config);

      expect(result.mcp.enabled).toBe(false);
      expect(Object.keys(result.mcp.servers).length).toBe(0);
    });
  });
});
