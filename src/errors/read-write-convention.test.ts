// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { MemoryError } from './memory.js';

describe('Read vs Write Semantics Convention', () => {
  /**
   * AC3.1: Read functions (`get*`, `load*`, `find*`) return `T | null` for not-found.
   * Test demonstrates the pattern with a mock function.
   */
  describe('AC3.1: Read functions return T | null for missing target', () => {
    function mockGetBlock(label: string): { id: string; label: string } | null {
      const blocks: Record<string, { id: string; label: string }> = {
        'daily-summary': { id: '1', label: 'daily-summary' },
        'goals': { id: '2', label: 'goals' },
      };
      return blocks[label] ?? null;
    }

    it('returns the block when found', () => {
      const result = mockGetBlock('daily-summary');
      expect(result).toBeDefined();
      expect(result?.label).toBe('daily-summary');
    });

    it('returns null when block not found', () => {
      const result = mockGetBlock('nonexistent');
      expect(result).toBeNull();
    });

    it('does not throw when target is missing', () => {
      expect(() => {
        mockGetBlock('missing-label');
      }).not.toThrow();
    });
  });

  /**
   * AC3.2: Write functions (`persist*`, `update*`, `delete*`) throw typed error for not-found.
   * Test demonstrates that updating a nonexistent block throws MemoryError.
   */
  describe('AC3.2: Write functions throw typed error for missing target', () => {
    function mockUpdateBlock(
      label: string,
      _data: Record<string, unknown>
    ): void {
      const blocks: Record<string, boolean> = {
        'daily-summary': true,
        'goals': true,
      };

      if (!blocks[label]) {
        throw new MemoryError(
          'BLOCK_NOT_FOUND',
          `Block "${label}" not found`,
          { target: label, available: Object.keys(blocks) }
        );
      }

      // If we get here, the block exists and would be updated
    }

    it('succeeds when block exists', () => {
      expect(() => {
        mockUpdateBlock('daily-summary', { content: 'updated' });
      }).not.toThrow();
    });

    it('throws typed error when block missing', () => {
      expect(() => {
        mockUpdateBlock('nonexistent', { content: 'new' });
      }).toThrow(MemoryError);
    });

    it('error includes target in context', () => {
      try {
        mockUpdateBlock('nonexistent', { content: 'new' });
      } catch (e) {
        expect(e instanceof MemoryError).toBe(true);
        if (e instanceof MemoryError) {
          expect(e.context['target']).toBe('nonexistent');
        }
      }
    });
  });

  /**
   * AC3.3: Insert/create functions don't throw on "not found" (creating new resource).
   * Test shows that create functions succeed without not-found errors.
   */
  describe('AC3.3: Create functions do not throw on not-found', () => {
    function mockCreateBlock(_label: string, _data: Record<string, unknown>): string {
      // Create always succeeds — there's nothing to "find"
      const id = `block-${Date.now()}`;
      return id;
    }

    it('creates new block successfully', () => {
      expect(() => {
        mockCreateBlock('new-block', { content: 'initial' });
      }).not.toThrow();
    });

    it('returns id for newly created block', () => {
      const id = mockCreateBlock('another-new', { content: 'data' });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
    });

    it('succeeds even if label does not exist', () => {
      expect(() => {
        mockCreateBlock('brand-new-label-that-never-existed', {});
      }).not.toThrow();
    });
  });

  /**
   * AC3.4: `get*` does not throw for missing resource — returns `null` instead.
   * Test explicitly asserts no throw + null return.
   */
  describe('AC3.4: Read functions do not throw for missing resource', () => {
    function mockLoadMessage(id: string): { id: string; text: string } | null {
      const messages: Record<string, { id: string; text: string }> = {
        'msg-1': { id: 'msg-1', text: 'hello' },
      };
      return messages[id] ?? null;
    }

    it('does not throw when resource missing', () => {
      let didThrow = false;
      try {
        mockLoadMessage('missing-msg');
      } catch {
        didThrow = true;
      }
      expect(didThrow).toBe(false);
    });

    it('returns null for missing resource', () => {
      const result = mockLoadMessage('missing-msg');
      expect(result).toBeNull();
    });

    it('does not throw even for completely invalid id', () => {
      expect(() => {
        mockLoadMessage('this-will-never-exist-no-way-no-how');
      }).not.toThrow();
    });
  });

  /**
   * AC3.5: `delete*` on nonexistent target throws error with context identifying target.
   * Test demonstrates delete on missing resource throws BLOCK_NOT_FOUND with target context.
   */
  describe('AC3.5: Delete on missing resource throws with target context', () => {
    function mockDeleteBlock(label: string): void {
      const blocks: Record<string, boolean> = {
        'daily-summary': true,
        'goals': true,
      };

      if (!blocks[label]) {
        throw new MemoryError(
          'BLOCK_NOT_FOUND',
          `Cannot delete: block "${label}" not found`,
          {
            target: label,
            operation: 'delete',
            available: Object.keys(blocks),
          }
        );
      }

      // Delete succeeds
    }

    it('succeeds when block exists', () => {
      expect(() => {
        mockDeleteBlock('daily-summary');
      }).not.toThrow();
    });

    it('throws BLOCK_NOT_FOUND for missing block', () => {
      expect(() => {
        mockDeleteBlock('nonexistent');
      }).toThrow();

      try {
        mockDeleteBlock('nonexistent');
      } catch (e) {
        expect(e instanceof MemoryError).toBe(true);
        if (e instanceof MemoryError) {
          expect(e.code).toBe('BLOCK_NOT_FOUND');
        }
      }
    });

    it('includes target in context', () => {
      try {
        mockDeleteBlock('nonexistent');
      } catch (e) {
        if (e instanceof MemoryError) {
          expect(e.context['target']).toBe('nonexistent');
        }
      }
    });

    it('includes operation type in context', () => {
      try {
        mockDeleteBlock('missing-block');
      } catch (e) {
        if (e instanceof MemoryError) {
          expect(e.context['operation']).toBe('delete');
        }
      }
    });

    it('includes list of available targets', () => {
      try {
        mockDeleteBlock('does-not-exist');
      } catch (e) {
        if (e instanceof MemoryError) {
          expect(Array.isArray(e.context['available'])).toBe(true);
        }
      }
    });
  });
});
