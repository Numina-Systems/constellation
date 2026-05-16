// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { tokenBigrams } from './bigrams';

describe('tokenBigrams', () => {
  describe('basic tokenization', () => {
    it('empty string produces empty set', () => {
      const result = tokenBigrams('');
      expect(result.size).toBe(0);
    });

    it('single word produces a set with just that word', () => {
      const result = tokenBigrams('hello');
      expect(result.size).toBe(1);
      expect(result.has('hello')).toBe(true);
    });

    it('two words produce one bigram', () => {
      const result = tokenBigrams('hello world');
      expect(result.size).toBe(1);
      expect(result.has('hello world')).toBe(true);
    });

    it('three words produce two bigrams', () => {
      const result = tokenBigrams('the cat sat');
      expect(result.size).toBe(2);
      expect(result.has('the cat')).toBe(true);
      expect(result.has('cat sat')).toBe(true);
    });

    it('multiple words produce correct bigrams', () => {
      const result = tokenBigrams('one two three four');
      expect(result.size).toBe(3);
      expect(result.has('one two')).toBe(true);
      expect(result.has('two three')).toBe(true);
      expect(result.has('three four')).toBe(true);
    });
  });

  describe('normalization', () => {
    it('case normalization: The Cat and the cat produce identical bigrams', () => {
      const result1 = tokenBigrams('The Cat');
      const result2 = tokenBigrams('the cat');
      expect(result1).toEqual(result2);
    });

    it('mixed case is normalized to lowercase', () => {
      const result = tokenBigrams('Hello WORLD');
      expect(result.has('hello world')).toBe(true);
    });
  });

  describe('whitespace handling', () => {
    it('punctuation attached to words is preserved', () => {
      const result = tokenBigrams('hello, world!');
      expect(result.has('hello, world!')).toBe(true);
    });

    it('multiple spaces are handled correctly', () => {
      const result = tokenBigrams('hello    world');
      expect(result.size).toBe(1);
      expect(result.has('hello world')).toBe(true);
    });

    it('leading and trailing whitespace is stripped', () => {
      const result = tokenBigrams('   hello world   ');
      expect(result.size).toBe(1);
      expect(result.has('hello world')).toBe(true);
    });

    it('tabs and other whitespace are handled correctly', () => {
      const result = tokenBigrams('hello\tworld\ntest');
      expect(result.size).toBe(2);
      expect(result.has('hello world')).toBe(true);
      expect(result.has('world test')).toBe(true);
    });
  });

  describe('loop-detection.AC1.4 edge case: empty input', () => {
    it('empty string compared to non-empty produces empty set', () => {
      const empty = tokenBigrams('');
      const nonEmpty = tokenBigrams('hello world');
      expect(empty.size).toBe(0);
      expect(nonEmpty.size).toBeGreaterThan(0);
    });
  });
});
