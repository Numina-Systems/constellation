// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { resolveEnvVars, resolveServerConfigEnv } from './env.js';

describe('mcp-client.AC1.8: Env var expansion', () => {
  describe('resolveEnvVars: Basic variable expansion', () => {
    it('should expand ${HOME} to a value from env', () => {
      const result = resolveEnvVars('${HOME}/bin', { HOME: '/Users/test' });
      expect(result).toBe('/Users/test/bin');
    });

    it('should leave unresolvable vars as literal ${VAR}', () => {
      const result = resolveEnvVars('${MISSING}', {});
      expect(result).toBe('${MISSING}');
    });

    it('should expand multiple vars in one string', () => {
      const result = resolveEnvVars('${A}:${B}', { A: 'x', B: 'y' });
      expect(result).toBe('x:y');
    });

    it('should pass through strings without ${}', () => {
      const result = resolveEnvVars('plain-text-path', {});
      expect(result).toBe('plain-text-path');
    });

    it('should handle env values with special characters', () => {
      const result = resolveEnvVars('${PATH}', {
        PATH: '/usr/local/bin:/usr/bin',
      });
      expect(result).toBe('/usr/local/bin:/usr/bin');
    });

    it('should handle empty env record gracefully', () => {
      const result = resolveEnvVars('${VAR1}/${VAR2}', {});
      expect(result).toBe('${VAR1}/${VAR2}');
    });

    it('should handle mixed resolvable and unresolvable vars', () => {
      const result = resolveEnvVars('${FOUND}/${MISSING}', { FOUND: 'yes' });
      expect(result).toBe('yes/${MISSING}');
    });

    it('should handle adjacent var patterns', () => {
      const result = resolveEnvVars('${A}${B}', { A: 'hello', B: 'world' });
      expect(result).toBe('helloworld');
    });

    it('should handle nested-looking patterns (no recursive expansion)', () => {
      const result = resolveEnvVars('${A}', { A: '${B}', B: 'value' });
      // Should return the literal value of A, not expand ${B}
      expect(result).toBe('${B}');
    });

    it('should handle empty var names (malformed but safe)', () => {
      const result = resolveEnvVars('${}/text', {});
      // ${} should not match the regex pattern, so no expansion
      expect(result).toContain('${}/text');
    });
  });

  describe('resolveServerConfigEnv: Stdio server config', () => {
    it('should resolve command in stdio config', () => {
      const config = {
        transport: 'stdio' as const,
        command: '${BIN_DIR}/mcp-server',
        args: [],
        env: {},
      };

      const result = resolveServerConfigEnv(config, { BIN_DIR: '/usr/local/bin' });

      expect(result.transport).toBe('stdio');
      if (result.transport === 'stdio') {
        expect(result.command).toBe('/usr/local/bin/mcp-server');
      }
    });

    it('should resolve each args item in stdio config', () => {
      const config = {
        transport: 'stdio' as const,
        command: 'mcp-server',
        args: ['--port=${PORT}', '--host=${HOST}'],
        env: {},
      };

      const result = resolveServerConfigEnv(config, {
        PORT: '9000',
        HOST: 'localhost',
      });

      if (result.transport === 'stdio') {
        expect(result.args).toEqual(['--port=9000', '--host=localhost']);
      }
    });

    it('should resolve each env value in stdio config', () => {
      const config = {
        transport: 'stdio' as const,
        command: 'mcp-server',
        args: [],
        env: {
          API_KEY: '${SECRET_KEY}',
          DB_URL: '${DATABASE_URL}',
          LOG_LEVEL: 'debug',
        },
      };

      const result = resolveServerConfigEnv(config, {
        SECRET_KEY: 'secret123',
        DATABASE_URL: 'postgresql://localhost/db',
      });

      if (result.transport === 'stdio') {
        expect(result.env).toEqual({
          API_KEY: 'secret123',
          DB_URL: 'postgresql://localhost/db',
          LOG_LEVEL: 'debug',
        });
      }
    });

    it('should handle mixed resolvable and unresolvable vars in stdio config', () => {
      const config = {
        transport: 'stdio' as const,
        command: '${BIN}/mcp',
        args: ['${ARG}'],
        env: { KEY: '${MISSING}' },
      };

      const result = resolveServerConfigEnv(config, { BIN: '/bin' });

      if (result.transport === 'stdio') {
        expect(result.command).toBe('/bin/mcp');
        expect(result.args).toEqual(['${ARG}']);
        expect(result.env['KEY']).toBe('${MISSING}');
      }
    });

    it('should preserve empty args and env in stdio config', () => {
      const config = {
        transport: 'stdio' as const,
        command: 'mcp-server',
        args: [],
        env: {},
      };

      const result = resolveServerConfigEnv(config, {});

      if (result.transport === 'stdio') {
        expect(result.args).toEqual([]);
        expect(result.env).toEqual({});
      }
    });
  });

  describe('resolveServerConfigEnv: HTTP server config', () => {
    it('should resolve url in http config', () => {
      const config = {
        transport: 'http' as const,
        url: 'https://${DOMAIN}:${PORT}/api',
      };

      const result = resolveServerConfigEnv(config, {
        DOMAIN: 'server.example.com',
        PORT: '8443',
      });

      expect(result.transport).toBe('http');
      if (result.transport === 'http') {
        expect(result.url).toBe('https://server.example.com:8443/api');
      }
    });

    it('should handle unresolvable vars in http url', () => {
      const config = {
        transport: 'http' as const,
        url: '${PROTOCOL}://localhost',
      };

      const result = resolveServerConfigEnv(config, {});

      if (result.transport === 'http') {
        expect(result.url).toBe('${PROTOCOL}://localhost');
      }
    });

    it('should leave simple urls unchanged if no vars present', () => {
      const config = {
        transport: 'http' as const,
        url: 'https://api.example.com',
      };

      const result = resolveServerConfigEnv(config, {});

      if (result.transport === 'http') {
        expect(result.url).toBe('https://api.example.com');
      }
    });
  });

  describe('resolveServerConfigEnv: Round-trip properties', () => {
    it('should be idempotent when env has all vars', () => {
      const config = {
        transport: 'stdio' as const,
        command: '${BIN}/mcp',
        args: ['${ARG}'],
        env: { KEY: '${VAL}' },
      };

      const env = { BIN: '/bin', ARG: 'arg1', VAL: 'value1' };

      const result1 = resolveServerConfigEnv(config, env);
      const result2 = resolveServerConfigEnv(result1, env);

      if (result1.transport === 'stdio' && result2.transport === 'stdio') {
        // Second expansion should not change already-resolved values
        expect(result2.command).toBe(result1.command);
        expect(result2.args).toEqual(result1.args);
        expect(result2.env).toEqual(result1.env);
      }
    });

    it('should preserve transport type through resolution', () => {
      const stdioConfig = {
        transport: 'stdio' as const,
        command: '${CMD}',
        args: [],
        env: {},
      };

      const httpConfig = {
        transport: 'http' as const,
        url: 'https://localhost',
      };

      const stdioResult = resolveServerConfigEnv(stdioConfig, { CMD: 'cmd' });
      const httpResult = resolveServerConfigEnv(httpConfig, {});

      expect(stdioResult.transport).toBe('stdio');
      expect(httpResult.transport).toBe('http');
    });
  });

  describe('Edge cases and robustness', () => {
    it('should handle var names with underscores and numbers', () => {
      const result = resolveEnvVars('${VAR_NAME_123}', {
        VAR_NAME_123: 'value',
      });
      expect(result).toBe('value');
    });

    it('should handle unicode in var values', () => {
      const result = resolveEnvVars('${MSG}', { MSG: 'Hello 🌍' });
      expect(result).toBe('Hello 🌍');
    });

    it('should handle dollar signs in var values (no double-expansion)', () => {
      const result = resolveEnvVars('${VAL}', { VAL: '$PATH' });
      expect(result).toBe('$PATH');
    });

    it('should handle very long var values', () => {
      const longValue = 'x'.repeat(10000);
      const result = resolveEnvVars('${LONG}', { LONG: longValue });
      expect(result).toBe(longValue);
    });

    it('should handle many var references in one string', () => {
      const varRefs = Array.from({ length: 100 })
        .map((_, i) => `\${V${i}}`)
        .join(':');
      const env = Object.fromEntries(
        Array.from({ length: 100 }).map((_, i) => [`V${i}`, `val${i}`]),
      );

      const result = resolveEnvVars(varRefs, env);

      const expected = Array.from({ length: 100 })
        .map((_, i) => `val${i}`)
        .join(':');
      expect(result).toBe(expected);
    });
  });
});
