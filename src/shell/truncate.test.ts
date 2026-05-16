import {describe, it, expect} from 'bun:test';
import {truncateOutput} from './truncate';

describe('truncateOutput', () => {
  describe('stateful-shell.AC3.3: Output exceeding max_output_bytes is truncated with marker', () => {
    it('passes through string under byte limit unchanged', () => {
      const short = 'hello world';
      const result = truncateOutput(short, 100);
      expect(result).toBe('hello world');
    });

    it('passes through string at exact byte limit unchanged', () => {
      const exact = 'hello';
      const byteLength = Buffer.byteLength(exact, 'utf8');
      const result = truncateOutput(exact, byteLength);
      expect(result).toBe('hello');
    });

    it('truncates string over byte limit with marker', () => {
      const long = 'hello world this is a longer string';
      const result = truncateOutput(long, 10);
      expect(result).toContain('[truncated —');
      expect(result).not.toContain('longer');
    });

    it('includes actual total byte count in marker', () => {
      const text = 'hello world';
      const totalBytes = Buffer.byteLength(text, 'utf8');
      const result = truncateOutput(text, 5);
      expect(result).toContain(`[truncated — ${totalBytes} bytes total]`);
    });

    it('handles multi-byte UTF-8 characters correctly', () => {
      const withEmoji = 'hello 👋 world';
      const totalBytes = Buffer.byteLength(withEmoji, 'utf8');
      // Emoji is 4 bytes, so truncating at byte 8 should not create partial character
      const result = truncateOutput(withEmoji, 8);
      // Should not have broken emoji or character
      expect(result).not.toContain('👋');
      // Marker should show total bytes
      expect(result).toContain(`[truncated — ${totalBytes} bytes total]`);
    });

    it('handles strings with accented characters', () => {
      const withAccents = 'café résumé';
      const totalBytes = Buffer.byteLength(withAccents, 'utf8');
      const result = truncateOutput(withAccents, 5);
      // Should handle multi-byte characters gracefully
      expect(result).toContain('[truncated —');
      expect(result).toContain(`${totalBytes} bytes total]`);
    });

    it('marker shows correct byte count for large output', () => {
      const large = 'x'.repeat(100000);
      const result = truncateOutput(large, 1000);
      expect(result).toContain('[truncated — 100000 bytes total]');
    });
  });

  describe('stateful-shell.AC3.4: Empty output returns empty string, not null', () => {
    it('returns empty string for empty input', () => {
      expect(truncateOutput('', 100)).toBe('');
    });

    it('returns empty string for empty input with zero max bytes', () => {
      expect(truncateOutput('', 0)).toBe('');
    });
  });
});
