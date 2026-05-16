import { describe, it, expect, afterEach } from 'bun:test';
import { createShellSession, ShellCreationError } from './session';
import type { ShellSession } from './types';

describe('createShellSession', () => {
  let session: ShellSession | null = null;

  afterEach(async () => {
    if (session?.isAlive) {
      await session.destroy();
    }
  });

  describe('stateful-shell.AC1.1: Session lifecycle', () => {
    it('creates a shell session that is alive', async () => {
      session = await createShellSession();
      expect(session.isAlive).toBe(true);
    });

    it('session can be destroyed', async () => {
      session = await createShellSession();
      expect(session.isAlive).toBe(true);

      await session.destroy();
      expect(session.isAlive).toBe(false);
    });
  });

  describe('stateful-shell.AC1.2: Session survives multiple execute calls', () => {
    it('executes multiple commands sequentially', async () => {
      session = await createShellSession();

      const result1 = await session.execute('echo first');
      expect(result1.output).toContain('first');
      expect(result1.exitCode).toBe(0);
      expect(session.isAlive).toBe(true);

      const result2 = await session.execute('echo second');
      expect(result2.output).toContain('second');
      expect(result2.exitCode).toBe(0);
      expect(session.isAlive).toBe(true);

      const result3 = await session.execute('echo third');
      expect(result3.output).toContain('third');
      expect(result3.exitCode).toBe(0);
      expect(session.isAlive).toBe(true);
    });
  });

  describe('stateful-shell.AC1.3: Idle timeout', () => {
    it('destroys session after idle timeout', async () => {
      session = await createShellSession({ idleTimeout: 100 });
      expect(session.isAlive).toBe(true);

      // Wait for idle timeout to fire
      await new Promise(r => setTimeout(r, 150));

      expect(session.isAlive).toBe(false);
    });
  });

  describe('stateful-shell.AC1.5: Creation failure', () => {
    it('throws ShellCreationError for nonexistent shell binary', async () => {
      expect(async () => {
        await createShellSession({ shell: '/nonexistent/shell/binary' });
      }).toThrow(ShellCreationError);
    });
  });

  describe('stateful-shell.AC2.1: Environment variable persistence', () => {
    it('preserves exported variables across commands', async () => {
      session = await createShellSession();

      await session.execute('export FOO=bar');
      const result = await session.execute('echo $FOO');

      expect(result.output).toContain('bar');
    });
  });

  describe('stateful-shell.AC2.2: Working directory persistence', () => {
    it('preserves working directory across commands', async () => {
      session = await createShellSession();

      await session.execute('cd /tmp');
      const result = await session.execute('pwd');

      expect(result.output).toContain('/tmp');
      expect(session.workingDirectory).toBe('/tmp');
    });
  });

  describe('stateful-shell.AC2.3: Alias persistence', () => {
    it('preserves aliases across commands', async () => {
      session = await createShellSession();

      await session.execute("alias hi='echo hello'");
      const result = await session.execute('hi');

      expect(result.output).toContain('hello');
    });
  });

  describe('stateful-shell.AC3.1: Output capture', () => {
    it('captures stdout', async () => {
      session = await createShellSession();
      const result = await session.execute('echo test');

      expect(result.output).toContain('test');
    });

    it('captures stderr', async () => {
      session = await createShellSession();
      const result = await session.execute('ls /nonexistent_path_xyz 2>&1');

      expect(result.output).toContain('No such file or directory');
    });

    it('captures both stdout and stderr', async () => {
      session = await createShellSession();
      const result = await session.execute('(echo stdout; echo stderr >&2) 2>&1');

      expect(result.output).toContain('stdout');
      expect(result.output).toContain('stderr');
    });
  });

  describe('stateful-shell.AC4.1 & AC4.2: Marker detection and stripping', () => {
    it('completes commands using marker detection', async () => {
      session = await createShellSession();
      const result = await session.execute('echo test');

      expect(result.output).toContain('test');
      // Marker should be stripped
      expect(result.output).not.toContain('___CSML___');
    });

    it('strips marker from output', async () => {
      session = await createShellSession();
      const result = await session.execute('echo hello');

      expect(result.output).not.toContain('___CSML___');
    });
  });

  describe('stateful-shell.AC4.3: No-output commands', () => {
    it('completes commands with no output', async () => {
      session = await createShellSession();
      const result = await session.execute('true');

      expect(result.exitCode).toBe(0);
      expect(result.output).toBe('');
    });
  });

  describe('stateful-shell.AC5.1: Command timeout', () => {
    it('times out long-running commands and returns partial output', async () => {
      session = await createShellSession({ commandTimeout: 300 });
      const result = await session.execute('sleep 60');

      expect(result.timedOut).toBe(true);
      expect(result.output).toContain('[timeout after');
      expect(session.isAlive).toBe(true);
    });
  });

  describe('stateful-shell.AC5.3: SIGKILL escalation', () => {
    it('escalates to SIGKILL if process ignores SIGINT', async () => {
      session = await createShellSession({ commandTimeout: 300 });

      // Try to execute a command that ignores SIGINT
      // Note: This may take a few seconds as it involves timeout + grace period
      const result = await session.execute("trap '' INT; sleep 60");

      // Session should be marked as dead after SIGKILL
      expect(session.isAlive).toBe(false);
      expect(result.timedOut).toBe(true);
    });
  });

  describe('stateful-shell.AC5.4: Exit code capture', () => {
    it('captures exit code 0', async () => {
      session = await createShellSession();
      const result = await session.execute('true');

      expect(result.exitCode).toBe(0);
    });

    it('captures exit code 1', async () => {
      session = await createShellSession();
      const result = await session.execute('false');

      expect(result.exitCode).toBe(1);
    });

    it('captures custom exit codes', async () => {
      session = await createShellSession();
      const result = await session.execute("bash -c 'exit 42'");

      expect(result.exitCode).toBe(42);
    });
  });

  describe('stateful-shell.AC5.2: Root check', () => {
    it.skipIf(process.getuid?.() !== 0)(
      'rejects creation when running as root',
      async () => {
        expect(async () => {
          await createShellSession();
        }).toThrow(ShellCreationError);
      }
    );
  });
});
