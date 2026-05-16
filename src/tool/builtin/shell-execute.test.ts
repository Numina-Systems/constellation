// pattern: Imperative Shell

import {describe, test, expect, mock} from 'bun:test';
import {createShellExecuteTool} from './shell-execute';
import type {ShellSession, ShellResult} from '@/shell/types';

function createMockSession(result: ShellResult): ShellSession {
  return {
    execute: mock(async () => result),
    destroy: mock(async () => {}),
    isAlive: true,
    workingDirectory: result.workingDirectory,
  };
}

describe('stateful-shell.AC1.4: session reuse', () => {
  test('multiple tool invocations use the same session instance', async () => {
    const mockExecute = mock(async () => ({
      output: '',
      exitCode: 0,
      workingDirectory: '/tmp',
      timedOut: false,
    }));
    const session: ShellSession = {
      execute: mockExecute,
      destroy: mock(async () => {}),
      isAlive: true,
      workingDirectory: '/tmp',
    };
    const tool = createShellExecuteTool(session);

    await tool.handler({command: 'first'});
    await tool.handler({command: 'second'});
    await tool.handler({command: 'third'});

    expect(mockExecute).toHaveBeenCalledTimes(3);
    expect(mockExecute).toHaveBeenCalledWith('first');
    expect(mockExecute).toHaveBeenCalledWith('second');
    expect(mockExecute).toHaveBeenCalledWith('third');
  });
});

describe('stateful-shell.AC6.4: registry dispatch integration', () => {
  test('tool is dispatchable through registry', async () => {
    const session = createMockSession({
      output: 'dispatched',
      exitCode: 0,
      workingDirectory: '/tmp',
      timedOut: false,
    });
    const tool = createShellExecuteTool(session);

    // Simulate registry dispatch: validate params exist, call handler
    const params = {command: 'echo test'};
    const commandParam = tool.definition.parameters.find((p) => p.name === 'command');
    expect(commandParam?.required).toBe(true);
    expect(typeof params.command).toBe('string');

    const result = await tool.handler(params);
    expect(result.success).toBe(true);
    expect(result.output).toContain('dispatched');
  });
});

describe('shell_execute tool', () => {
  describe('tool definition', () => {
    test('has name shell_execute', () => {
      const session = createMockSession({
        output: '',
        exitCode: 0,
        workingDirectory: '/tmp',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      expect(tool.definition.name).toBe('shell_execute');
    });

    test('has command parameter (required, string)', () => {
      const session = createMockSession({
        output: '',
        exitCode: 0,
        workingDirectory: '/tmp',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      const commandParam = tool.definition.parameters.find((p) => p.name === 'command');
      expect(commandParam).toBeDefined();
      expect(commandParam?.type).toBe('string');
      expect(commandParam?.required).toBe(true);
    });

    test('description mentions persistent shell', () => {
      const session = createMockSession({
        output: '',
        exitCode: 0,
        workingDirectory: '/tmp',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      expect(tool.definition.description.toLowerCase()).toContain('persistent');
      expect(tool.definition.description.toLowerCase()).toContain('not a fresh subprocess');
    });
  });

  describe('handler', () => {
    test('successful command (exit 0) returns success true with output and cwd', async () => {
      const session = createMockSession({
        output: 'hello world',
        exitCode: 0,
        workingDirectory: '/home/user',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      const result = await tool.handler({command: 'echo hello'});

      expect(result.success).toBe(true);
      expect(result.output).toContain('hello world');
      expect(result.output).toContain('[exit code: 0]');
      expect(result.output).toContain('[cwd: /home/user]');
      expect(result.error).toBeUndefined();
    });

    test('failed command (exit 1) returns success false with error', async () => {
      const session = createMockSession({
        output: 'error output',
        exitCode: 1,
        workingDirectory: '/home/user',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      const result = await tool.handler({command: 'false'});

      expect(result.success).toBe(false);
      expect(result.output).toContain('error output');
      expect(result.output).toContain('[exit code: 1]');
      expect(result.output).toContain('[cwd: /home/user]');
      expect(result.error).toContain('Command exited with code 1');
    });

    test('timed out command returns success false with timeout error', async () => {
      const session = createMockSession({
        output: 'partial output',
        exitCode: null,
        workingDirectory: '/home/user',
        timedOut: true,
      });
      const tool = createShellExecuteTool(session);
      const result = await tool.handler({command: 'long-running'});

      expect(result.success).toBe(false);
      expect(result.output).toContain('partial output');
      expect(result.output).toContain('[cwd: /home/user]');
      expect(result.output).not.toContain('[exit code:');
      expect(result.error).toBe('Command timed out');
    });

    test('calls session.execute with command parameter', async () => {
      const mockExecute = mock(async () => ({
        output: '',
        exitCode: 0,
        workingDirectory: '/tmp',
        timedOut: false,
      }));
      const session: ShellSession = {
        execute: mockExecute,
        destroy: mock(async () => {}),
        isAlive: true,
        workingDirectory: '/tmp',
      };
      const tool = createShellExecuteTool(session);
      await tool.handler({command: 'ls -la'});

      expect(mockExecute).toHaveBeenCalledWith('ls -la');
      expect(mockExecute).toHaveBeenCalledTimes(1);
    });

    test('empty output with exit code 0 returns success', async () => {
      const session = createMockSession({
        output: '',
        exitCode: 0,
        workingDirectory: '/tmp',
        timedOut: false,
      });
      const tool = createShellExecuteTool(session);
      const result = await tool.handler({command: 'true'});

      expect(result.success).toBe(true);
      expect(result.output).toContain('[exit code: 0]');
      expect(result.output).toContain('[cwd: /tmp]');
    });
  });
});
