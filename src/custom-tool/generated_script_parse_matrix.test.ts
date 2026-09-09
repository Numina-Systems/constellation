import {afterEach, describe, expect, test} from 'bun:test';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createToolRegistry} from '@/tool/registry.ts';
import type {Tool, ToolParameter} from '@/tool/types.ts';
import {generateSecretConstants} from '@/runtime/executor.ts';

const temporaryDirectories: Array<string> = [];

function tool(name: string, parameters: ReadonlyArray<ToolParameter>): Tool {
  return {definition: {name, description: 'hostile \"description\" 😀', parameters}, handler: async () => ({success: true, output: 'ok'})};
}

async function denoCheck(source: string): Promise<{code: number; output: string}> {
  const directory = await mkdtemp(join(tmpdir(), 'constellation-script-'));
  temporaryDirectories.push(directory);
  const path = join(directory, 'generated.ts');
  await writeFile(path, `${source}\n`, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn('deno', ['check', '--quiet', path], {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
    child.once('error', reject);
    child.once('close', (code) => resolve({code: code ?? 1, output: output.slice(0, 4_000)}));
  });
}

afterEach(async () => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (directory !== undefined) await rm(directory, {recursive: true, force: true});
  }
});

describe('generated_script_parse_matrix', () => {
  test('hostile valid metadata generates parseable Deno TypeScript with escaped enums and unicode', async () => {
    const registry = createToolRegistry();
    registry.register(tool('hostile_tool', [
      {name: 'reserved_value', type: 'string', description: 'reserved', required: true, enum_values: ['quote "', 'slash \\', 'line\n😀']},
      {name: 'items', type: 'array', description: 'unicode 😀', required: false},
    ]));
    const source = `${registry.generateStubs()}\nconst __callTool__ = async (_name: string, _params: unknown): Promise<unknown> => null;`;
    const result = await denoCheck(source);
    expect(result.code).toBe(0);
    expect(result.output).toBe('');
    expect(source).toContain('reserved_value: string');
    expect(source).toContain('type array = unknown[];');
    expect(source).toContain('items?: array');
  });

  test('invalid and colliding secret identifiers are skipped, while valid secrets are JSON escaped', () => {
    const constants = generateSecretConstants({secrets: {
      SAFE_SECRET: 'quote " slash \\ newline\n😀',
      Deno: 'must not shadow runtime',
      output: 'must not shadow runtime',
      console: 'must not shadow runtime',
      __callTool__: 'must not shadow runtime',
      'not-valid': 'must not be injected',
      __proto__: 'must not poison the object',
    }});
    expect(constants).toContain('const SAFE_SECRET =');
    expect(constants).not.toContain('const Deno =');
    expect(constants).not.toContain('const output =');
    expect(constants).not.toContain('const console =');
    expect(constants).not.toContain('const __callTool__ =');
    expect(constants).not.toContain('not-valid');
    expect(constants).not.toContain('__proto__');

    const registry = createToolRegistry();
    registry.register(tool('unrelated_tool', []));
    const unrelated = registry.generateStubs();
    expect(unrelated).not.toContain('SAFE_SECRET');
    expect(unrelated).not.toContain('must not be injected');

    const source = `${constants}\n${unrelated}\nconst observed = SAFE_SECRET;\nconst __callTool__ = async (_name: string, _params: unknown): Promise<unknown> => null;`;
    return denoCheck(source).then((result) => {
      expect(result.code).toBe(0);
      expect(result.output).toBe('');
    });
  });
});
