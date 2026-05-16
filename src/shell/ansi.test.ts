import {describe, it, expect} from 'bun:test';
import {stripAnsi} from './ansi';

describe('stripAnsi', () => {
  describe('stateful-shell.AC3.2: ANSI escape codes are stripped from output', () => {
    it('strips SGR colour codes', () => {
      const withColor = '\x1b[31mred\x1b[0m';
      expect(stripAnsi(withColor)).toBe('red');
    });

    it('strips SGR reset code', () => {
      const withReset = 'text\x1b[0mmore';
      expect(stripAnsi(withReset)).toBe('textmore');
    });

    it('strips SGR bold and color codes', () => {
      const withBoldColor = '\x1b[1;32mgreen\x1b[0m';
      expect(stripAnsi(withBoldColor)).toBe('green');
    });

    it('strips cursor movement sequences', () => {
      const withCursor = 'line1\x1b[Hline2';
      expect(stripAnsi(withCursor)).toBe('line1line2');
    });

    it('strips clear screen sequence', () => {
      const withClear = 'before\x1b[2Jafter';
      expect(stripAnsi(withClear)).toBe('beforeafter');
    });

    it('strips clear line sequence', () => {
      const withClearLine = 'text\x1b[Kmore';
      expect(stripAnsi(withClearLine)).toBe('textmore');
    });

    it('strips OSC title-setting sequences with BEL', () => {
      const withOsc = '\x1b]0;title\x07content';
      expect(stripAnsi(withOsc)).toBe('content');
    });

    it('strips OSC title-setting sequences with ST', () => {
      const withOsc = '\x1b]0;title\x1b\\content';
      expect(stripAnsi(withOsc)).toBe('content');
    });

    it('strips CSI with question mark and parameters', () => {
      const withCsi = 'text\x1b[?25hmore';
      expect(stripAnsi(withCsi)).toBe('textmore');
    });

    it('handles nested/multiple sequences in one string', () => {
      const complex = '\x1b[1;31m\x1b[1mred\x1b[0m\x1b[0m';
      expect(stripAnsi(complex)).toBe('red');
    });

    it('passes through clean strings unchanged', () => {
      const clean = 'no codes here';
      expect(stripAnsi(clean)).toBe('no codes here');
    });
  });

  describe('stateful-shell.AC3.4: Empty output returns empty string, not null', () => {
    it('returns empty string for empty input', () => {
      expect(stripAnsi('')).toBe('');
    });
  });
});
