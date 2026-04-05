// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { detectTuiMode } from './detect.ts';

describe('detectTuiMode', () => {
  describe('tui.AC8.1: --tui flag in TTY environment enables TUI mode', () => {
    it('returns useTui true and no warning when --tui flag is present and isTty is true', () => {
      const result = detectTuiMode(['node', 'start', '--tui'], true);

      expect(result.useTui).toBe(true);
      expect(result.warning).toBe(null);
    });
  });

  describe('tui.AC8.2: No flag launches existing readline REPL unchanged', () => {
    it('returns useTui false and no warning when --tui flag is absent', () => {
      const result = detectTuiMode(['node', 'start'], true);

      expect(result.useTui).toBe(false);
      expect(result.warning).toBe(null);
    });
  });

  describe('tui.AC8.3: --tui in non-TTY environment falls back gracefully', () => {
    it('returns useTui false with warning when --tui flag is present but isTty is false', () => {
      const result = detectTuiMode(['node', 'start', '--tui'], false);

      expect(result.useTui).toBe(false);
      expect(result.warning).not.toBe(null);
      expect(result.warning).toContain('--tui flag ignored');
      expect(result.warning).toContain('not running in a TTY environment');
      expect(result.warning).toContain('falling back to REPL');
    });
  });

  describe('edge cases', () => {
    it('handles empty argv array', () => {
      const result = detectTuiMode([], true);

      expect(result.useTui).toBe(false);
      expect(result.warning).toBe(null);
    });

    it('handles --tui flag at different positions in argv', () => {
      const result1 = detectTuiMode(['--tui', 'node', 'start'], true);
      const result2 = detectTuiMode(['node', '--tui', 'start'], true);
      const result3 = detectTuiMode(['node', 'start', '--tui'], true);

      expect(result1.useTui).toBe(true);
      expect(result2.useTui).toBe(true);
      expect(result3.useTui).toBe(true);
    });

    it('ignores similar flags like --tui-debug', () => {
      const result = detectTuiMode(['node', 'start', '--tui-debug'], true);

      expect(result.useTui).toBe(false);
    });

    it('is case-sensitive for --tui flag', () => {
      const result = detectTuiMode(['node', 'start', '--TUI'], true);

      expect(result.useTui).toBe(false);
    });
  });
});
