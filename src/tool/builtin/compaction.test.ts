/**
 * Tests for the compact_context tool definition.
 * Verifies tool registration, definition properties, and handler.
 */

import { describe, it, expect } from 'bun:test';
import { createCompactContextTool } from './compaction.ts';

describe('createCompactContextTool', () => {
  it('returns a valid Tool object', () => {
    const tool = createCompactContextTool();
    expect(tool).toHaveProperty('definition');
    expect(tool).toHaveProperty('handler');
  });

  describe('tool definition', () => {
    it('has name "compact_context"', () => {
      const tool = createCompactContextTool();
      expect(tool.definition.name).toBe('compact_context');
    });

    it('has a non-empty description', () => {
      const tool = createCompactContextTool();
      expect(tool.definition.description).toBeTruthy();
      expect(tool.definition.description.length).toBeGreaterThan(0);
    });

    it('has empty parameters array', () => {
      const tool = createCompactContextTool();
      expect(Array.isArray(tool.definition.parameters)).toBe(true);
      expect(tool.definition.parameters.length).toBe(0);
    });
  });

  describe('handler', () => {
    it('is an async function', () => {
      const tool = createCompactContextTool();
      expect(typeof tool.handler).toBe('function');
    });

    it('returns error result indicating special-case handling', async () => {
      const tool = createCompactContextTool();
      const result = await tool.handler({});
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
      expect(result.error).toContain('agent loop');
    });
  });
});
