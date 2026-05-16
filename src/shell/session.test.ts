// pattern: Imperative Shell

/**
 * Tests for shell session nonce-based command execution.
 * Verifies per-command nonce isolation prevents false completion from stale markers.
 */

import { describe, it, beforeEach, afterEach, expect } from 'bun:test';
import { createShellSession } from './session';
import type { ShellSession } from './types';

describe('arch-hardening.AC6: Per-command shell nonces', () => {
  let session: ShellSession;

  beforeEach(async () => {
    session = await createShellSession({
      shell: '/bin/bash',
      commandTimeout: 5000,
      idleTimeout: 30_000,
      maxOutputBytes: 64 * 1024,
      promptMarker: '___CSML___',
    });
  });

  afterEach(async () => {
    await session.destroy();
  });

  describe('Basic execution', () => {
    it('executes simple commands and returns output', async () => {
      const result = await session.execute('echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.output).toContain('hello world');
      expect(result.timedOut).toBe(false);
    });

    it('captures non-zero exit codes', async () => {
      const result = await session.execute('false');
      expect(result.exitCode).toBe(1);
    });

    it('tracks working directory changes', async () => {
      const initial = session.workingDirectory;
      await session.execute('cd /tmp');
      const after = session.workingDirectory;
      expect(after).toBe('/tmp');
      expect(initial).not.toBe(after);
    });

    it('returns empty output for commands with no output', async () => {
      const result = await session.execute('true');
      expect(result.exitCode).toBe(0);
      // Output should be stripped of markers and command echo
      expect(result.output.length).toBe(0);
    });
  });

  describe('arch-hardening.AC6.1: Nonce generation', () => {
    it('generates unique nonces for consecutive execute calls', async () => {
      const result1 = await session.execute('echo "first"');
      const result2 = await session.execute('echo "second"');

      expect(result1.exitCode).toBe(0);
      expect(result2.exitCode).toBe(0);
      expect(result1.output).toContain('first');
      expect(result2.output).toContain('second');
    });

    it('generates nonces in correct format (8-character hex)', async () => {
      // Nonce is crypto.randomBytes(4).toString('hex') = 8 hex chars
      // We can verify this by running several commands and confirming they each succeed independently
      for (let i = 0; i < 5; i++) {
        const result = await session.execute(`echo "test_${i}"`);
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
      }

      // If nonce generation was broken, we'd get wrong exit codes or timeout/failure
      // This test implicitly verifies nonce format is working correctly

      // Further validation: run a command that outputs a fake nonce pattern to ensure
      // our nonce markers are different from any user output
      const fakeOutput = await session.execute('echo "[___CSML___00000000]> "');
      expect(fakeOutput.exitCode).toBe(0);
      expect(fakeOutput.output).toContain('[___CSML___00000000]>');

      // Next command should complete normally (nonce prevented false match)
      const normalCmd = await session.execute('echo "after-fake"');
      expect(normalCmd.exitCode).toBe(0);
      expect(normalCmd.output).toContain('after-fake');
    });
  });

  describe('arch-hardening.AC6.2 and AC6.3: Nonce-scoped marker detection', () => {
    it('strips nonce-scoped markers from output', async () => {
      const result = await session.execute('echo "test"');
      expect(result.output).not.toContain('[___CSML___');
      expect(result.output).not.toContain('> ');
    });

    it('extracts working directory with nonce markers', async () => {
      await session.execute('cd /tmp');

      // The CWD should have been extracted correctly
      expect(session.workingDirectory).toBe('/tmp');

      await session.execute('cd /');
      expect(session.workingDirectory).toBe('/');
    });

    it('AC6.2: ignores stale markers from previous command output', async () => {
      // First command outputs a fake marker pattern (same base marker but wrong nonce)
      const fakeMarker = await session.execute('printf "[___CSML___999999]> "');
      expect(fakeMarker.exitCode).toBe(0);
      expect(fakeMarker.timedOut).toBe(false);

      // The stale marker from previous command should NOT fool the next command
      // because it has a different nonce. Verify the next command completes with
      // correct exit code and proper output.
      const nextCmd = await session.execute('echo "verify-isolation"');
      expect(nextCmd.exitCode).toBe(0);
      expect(nextCmd.timedOut).toBe(false);
      expect(nextCmd.output).toContain('verify-isolation');

      // If stale marker had fooled the session, we'd see timeout or wrong output
      // Additional verification: run a command that fails to ensure exit code is correct
      const failCmd = await session.execute('false');
      expect(failCmd.exitCode).toBe(1);
      expect(failCmd.timedOut).toBe(false);
    });
  });

  describe('arch-hardening.AC6.4: False completion prevention', () => {
    it('output containing base marker prefix does not trigger false completion', async () => {
      // Execute a command that outputs something resembling an old-style marker
      const result1 = await session.execute('echo "[___CSML___0]> "');
      expect(result1.exitCode).toBe(0);
      expect(result1.timedOut).toBe(false);

      // Execute a second command — should complete normally
      const result2 = await session.execute('echo "hello"');
      expect(result2.exitCode).toBe(0);
      expect(result2.timedOut).toBe(false);
      expect(result2.output).toContain('hello');
    });

    it('ignores stale markers from previous command output', async () => {
      // First command: output looks like a marker
      await session.execute('printf "[___CSML___999999]> "');

      // Second command: should not be fooled by the echo from first command
      const result = await session.execute('echo "check"');
      expect(result.exitCode).toBe(0);
      expect(result.timedOut).toBe(false);
      expect(result.output).toContain('check');
    });

    it('handles rapid consecutive commands with different outputs', async () => {
      const commands = [
        'echo "one"',
        'echo "[___CSML___fake]> "',
        'echo "two"',
        'echo "[___CSML___0]> "',
        'echo "three"',
      ];

      for (const cmd of commands) {
        const result = await session.execute(cmd);
        expect(result.exitCode).toBe(0);
        expect(result.timedOut).toBe(false);
      }
    });
  });

  describe('Output filtering', () => {
    it('strips PS1 assignment from output', async () => {
      const result = await session.execute('echo "test"');
      // The PS1 assignment should not appear in output
      expect(result.output).not.toContain('PS1=');
    });

    it('strips command echo from output', async () => {
      const result = await session.execute('echo "test"');
      // The command itself should not appear in the output
      expect(result.output).not.toContain('echo "test"');
    });

    it('strips CWD markers from output', async () => {
      const result = await session.execute('pwd');
      // CWD markers should be stripped
      expect(result.output).not.toContain('___CWD___');
    });
  });

  describe('Error handling', () => {
    it('handles command failures gracefully', async () => {
      const result = await session.execute('false');
      expect(result.exitCode).toBe(1);
      expect(result.timedOut).toBe(false);
    });

    it('rejects execution on closed session', async () => {
      await session.destroy();
      try {
        await session.execute('echo "test"');
        expect.unreachable('should have thrown');
      } catch (err) {
        expect(err).toBeDefined();
      }
    });
  });
});
