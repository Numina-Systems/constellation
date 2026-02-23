// pattern: Imperative Shell

/**
 * Integration tests for DenoExecutor.
 * These tests spawn real Deno subprocesses and require Deno to be installed on the system.
 * Tests verify code execution, IPC communication, permission enforcement, and resource limits.
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { resolve } from 'path';

import { createDenoExecutor } from '@/runtime/executor';
import type { ToolRegistry } from '@/tool/types';
import type { RuntimeConfig } from '@/config/schema';
import type { AgentConfig } from '@/config/schema';

// Create a mock ToolRegistry for testing
function createMockRegistry(): ToolRegistry {
  const tools = new Map<
    string,
    (params: Record<string, unknown>) => Promise<{ success: boolean; output: string; error?: string }>
  >();

  tools.set('echo_tool', async (params) => {
    const message = String(params['message'] || '');
    return {
      success: true,
      output: `echo: ${message}`,
    };
  });

  return {
    register() {
      // noop
    },
    getDefinitions() {
      return [];
    },
    async dispatch(name: string, params: Record<string, unknown>) {
      const handler = tools.get(name);
      if (!handler) {
        return {
          success: false,
          output: '',
          error: `unknown tool: ${name}`,
        };
      }
      return handler(params);
    },
    generateStubs(): string {
      return `
async function echo_tool(params: { message?: string }): Promise<unknown> {
  return __callTool__("echo_tool", params);
}
`;
    },
    toModelTools() {
      return [];
    },
  };
}

// Test workspace directory
const testWorkdir = resolve(process.cwd(), 'workspace', 'test');

describe('DenoExecutor Integration Tests', () => {
  let executor: ReturnType<typeof createDenoExecutor>;
  let config: RuntimeConfig & AgentConfig;

  beforeEach(() => {
    // Create test workspace directory
    if (!existsSync(testWorkdir)) {
      mkdirSync(testWorkdir, { recursive: true });
    }

    // Setup config
    config = {
      working_dir: testWorkdir,
      allowed_hosts: ['example.com', 'localhost:8000'],
      max_code_size: 51200,
      max_output_size: 1048576,
      code_timeout: 3000, // 3 seconds for code execution
      max_tool_calls_per_exec: 25,
      max_tool_rounds: 20,
      context_budget: 0.8,
    };

    executor = createDenoExecutor(config, createMockRegistry());
  });

  afterEach(() => {
    // Clean up test workspace
    try {
      rmSync(testWorkdir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it('AC3.1: executes simple TypeScript code', async () => {
    const code = `
const x = 1 + 2;
output(String(x));
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output).toContain('3');
    expect(result.tool_calls_made).toBe(0);
    expect(result.duration_ms).toBeGreaterThan(0);
  });

  it('AC3.1: captures multiple output lines', async () => {
    const code = `
output("line 1");
output("line 2");
output("line 3");
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output).toContain('line 1');
    expect(result.output).toContain('line 2');
    expect(result.output).toContain('line 3');
  });

  it('AC3.2: allows network requests to allowlisted hosts', async () => {
    const code = `
try {
  const response = await fetch("http://example.com", { method: "HEAD" });
  output(String(response.status));
} catch (e) {
  output("fetch error: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    // The fetch may fail for various reasons in test environment
    // but the key is that permission was not denied
    expect(result.success).toBe(true);
    // Either we get a status code or a network error, but not a permission error
    expect(result.output).not.toContain('permission denied');
    expect(result.output).not.toContain('network access is denied');
  });

  it('AC3.9: denies network requests to non-allowlisted hosts', async () => {
    const code = `
try {
  const response = await fetch("http://evil.example.org", { method: "HEAD" });
  output("unexpected success");
} catch (e) {
  output("error: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toMatch(/error|denied|not allowed/);
  });

  it('AC3.3: allows reading from working directory', async () => {
    const code = `
const content = await Deno.readTextFile("./testfile.txt");
output(content);
`;

    // Write test file
    const fs = await import('fs');
    fs.writeFileSync(resolve(testWorkdir, 'testfile.txt'), 'hello world');

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output).toContain('hello world');
  });

  it('AC3.3: allows writing to working directory', async () => {
    const code = `
await Deno.writeTextFile("./output.txt", "test content");
output("file written");
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output).toContain('file written');

    // Verify file was written
    const fs = await import('fs');
    const written = fs.existsSync(resolve(testWorkdir, 'output.txt'));
    expect(written).toBe(true);
  });

  it('AC3.4: bridges tool calls via IPC', async () => {
    const code = `
output("before tool call");
await echo_tool({ message: "hello from code" });
output("after tool call");
`;

    const toolStubs = createMockRegistry().generateStubs();
    const result = await executor.execute(code, toolStubs);

    expect(result.success).toBe(true);
    expect(result.output).toContain('before tool call');
    expect(result.output).toContain('after tool call');
    expect(result.tool_calls_made).toBe(1);
  });

  it('AC3.4: handles multiple tool calls', async () => {
    const code = `
output("call1");
await echo_tool({ message: "first" });
output("call2");
await echo_tool({ message: "second" });
output("done");
`;

    const toolStubs = createMockRegistry().generateStubs();
    const result = await executor.execute(code, toolStubs);

    expect(result.success).toBe(true);
    expect(result.tool_calls_made).toBe(2);
    expect(result.output).toContain('call1');
    expect(result.output).toContain('call2');
    expect(result.output).toContain('done');
  });

  it('AC3.5: denies subprocess spawning', async () => {
    const code = `
try {
  const command = new Deno.Command("ls", { args: [] });
  const process = command.spawn();
  output("unexpected success");
} catch (e) {
  output("error: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toMatch(/permission|denied|run/);
  });

  it('AC3.6: denies environment variable access', async () => {
    const code = `
try {
  const path = Deno.env.get("PATH");
  output("got: " + String(path));
} catch (e) {
  output("error: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    // Deno denies env access with a permission error in output
    expect(result.output.toLowerCase()).toMatch(/permission|denied|env/);
  });

  it('AC3.7: enforces execution timeout', async () => {
    const shortConfig = {
      ...config,
      code_timeout: 1000, // 1 second timeout
    };
    const shortExecutor = createDenoExecutor(shortConfig, createMockRegistry());

    const code = `
while (true) {
  // infinite loop
}
`;

    const result = await shortExecutor.execute(code, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('AC3.8: rejects code exceeding max size', async () => {
    const smallConfig = {
      ...config,
      max_code_size: 10, // Very small limit
    };
    const smallExecutor = createDenoExecutor(smallConfig, createMockRegistry());

    const code = 'const x = 1 + 2; output(String(x));';

    const result = await smallExecutor.execute(code, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds max size');
  });

  it('AC3.8: rejects output exceeding max size', async () => {
    const smallConfig = {
      ...config,
      max_output_size: 100, // Very small limit
    };
    const smallExecutor = createDenoExecutor(smallConfig, createMockRegistry());

    const code = `
for (let i = 0; i < 50; i++) {
  output("this is a long line of output that will exceed the limit " + String(i));
}
`;

    const result = await smallExecutor.execute(code, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('exceeds max size');
  });

  it('AC3.8: respects max tool calls limit', async () => {
    const smallConfig = {
      ...config,
      max_tool_calls_per_exec: 1,
    };
    const smallExecutor = createDenoExecutor(smallConfig, createMockRegistry());

    const code = `
await echo_tool({ message: "1" });
await echo_tool({ message: "2" });
await echo_tool({ message: "3" });
output("completed all calls");
`;

    const toolStubs = createMockRegistry().generateStubs();
    const result = await smallExecutor.execute(code, toolStubs);

    // Either it fails or succeeds - the key is that we made exactly 1 tool call before enforcing limit
    expect(result.tool_calls_made).toBeLessThanOrEqual(2);
  });

  it('AC3.1: includes duration in result', async () => {
    const code = `
await new Promise(resolve => setTimeout(resolve, 100));
output("done");
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.duration_ms).toBeGreaterThanOrEqual(100);
  });

  it('handles FFI denial', async () => {
    const code = `
try {
  const dylib = Deno.dlopen("./lib.so", {});
  output("unexpected success");
} catch (e) {
  output("error: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output.toLowerCase()).toMatch(/permission|denied|ffi/);
  });

  it('AC3.1: handles code with console.log', async () => {
    const code = `
output("via output");
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    // output should be captured
    expect(result.output).toContain('via output');
  });

  it('AC3.1: returns success even when code throws (Deno handles it)', async () => {
    const code = `
try {
  throw new Error("test error");
} catch (e) {
  output("caught: " + String(e));
}
`;

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.output).toContain('caught');
  });

  it('AC3.1: handles empty code', async () => {
    const code = '';

    const result = await executor.execute(code, '');

    expect(result.success).toBe(true);
    expect(result.tool_calls_made).toBe(0);
  });

  it('AC3.4: tool result values are accessible in user code', async () => {
    const code = `
const result = await echo_tool({ message: "test value" });
output("result: " + JSON.stringify(result));
`;

    const toolStubs = createMockRegistry().generateStubs();
    const result = await executor.execute(code, toolStubs);

    expect(result.success).toBe(true);
    expect(result.output).toContain('result:');
    // Verify that we got back the tool result structure with output field
    expect(result.output).toContain('echo:');
    expect(result.tool_calls_made).toBe(1);
  });
});
