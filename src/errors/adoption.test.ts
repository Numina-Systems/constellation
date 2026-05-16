// pattern: Functional Core

import { describe, it, expect } from 'bun:test';
import { ConstellationError } from './base.js';
import { MemoryError } from './memory.js';
import { ModelError } from './model.js';

describe('Incremental Adoption and Backward Compatibility', () => {
  /**
   * AC6.3: Code that doesn't use typed errors continues to work — adoption is opt-in.
   * Test demonstrates that plain `throw new Error()` still works in existing catch blocks.
   */
  describe('AC6.3: Opt-in adoption — un-migrated code still works', () => {
    function legacyCodeThatThrowsPlainError(shouldFail: boolean): void {
      if (shouldFail) {
        // Old code that hasn't been migrated yet
        throw new Error('legacy error message');
      }
    }

    function newCodeThatThrowsTypedError(shouldFail: boolean): void {
      if (shouldFail) {
        // New code using typed errors
        throw new MemoryError('BLOCK_NOT_FOUND', 'block not found');
      }
    }

    it('catches plain Error from legacy code', () => {
      let caught = false;
      try {
        legacyCodeThatThrowsPlainError(true);
      } catch (e) {
        caught = e instanceof Error;
      }
      expect(caught).toBe(true);
    });

    it('catches ConstellationError from new code', () => {
      let caught = false;
      try {
        newCodeThatThrowsTypedError(true);
      } catch (e) {
        caught = e instanceof Error;
      }
      expect(caught).toBe(true);
    });

    it('same catch block handles both plain Error and ConstellationError', () => {
      const handler = (f: () => void) => {
        let caught = false;
        try {
          f();
        } catch (e) {
          if (e instanceof Error) {
            caught = true;
          }
        }
        return caught;
      };

      expect(handler(() => legacyCodeThatThrowsPlainError(true))).toBe(true);
      expect(handler(() => newCodeThatThrowsTypedError(true))).toBe(true);
    });

    it('code without error handling continues to work', () => {
      // No try-catch, just calling functions
      expect(() => {
        legacyCodeThatThrowsPlainError(false); // succeeds
      }).not.toThrow();

      expect(() => {
        newCodeThatThrowsTypedError(false); // succeeds
      }).not.toThrow();
    });
  });

  /**
   * AC7.1: Each subsystem's errors can be adopted independently without touching others.
   * Test shows MemoryError can be used without importing other subsystem errors.
   */
  describe('AC7.1: Independent subsystem adoption', () => {
    function memorySubsystemFunction(shouldFail: boolean): void {
      if (shouldFail) {
        // Memory subsystem uses only MemoryError
        throw new MemoryError('PERMISSION_DENIED', 'access denied');
      }
    }

    function modelSubsystemFunction(shouldFail: boolean): void {
      if (shouldFail) {
        // Model subsystem uses only ModelError
        throw new ModelError('RATE_LIMITED', 'rate limit exceeded', true, { retryAfter: 60 });
      }
    }

    it('MemoryError can be used independently without ModelError', () => {
      let caught = false;
      let code: string | undefined;
      try {
        memorySubsystemFunction(true);
      } catch (e) {
        if (e instanceof MemoryError) {
          caught = true;
          code = e.code;
        }
      }
      expect(caught).toBe(true);
      expect(code).toBe('PERMISSION_DENIED');
    });

    it('ModelError can be used independently without MemoryError', () => {
      let caught = false;
      let code: string | undefined;
      try {
        modelSubsystemFunction(true);
      } catch (e) {
        if (e instanceof ModelError) {
          caught = true;
          code = e.code;
        }
      }
      expect(caught).toBe(true);
      expect(code).toBe('RATE_LIMITED');
    });

    it('memory and model subsystems can coexist independently', () => {
      const memoryErrors: string[] = [];
      const modelErrors: string[] = [];

      try {
        memorySubsystemFunction(true);
      } catch (e) {
        if (e instanceof MemoryError) {
          memoryErrors.push(e.code);
        }
      }

      try {
        modelSubsystemFunction(true);
      } catch (e) {
        if (e instanceof ModelError) {
          modelErrors.push(e.code);
        }
      }

      expect(memoryErrors).toHaveLength(1);
      expect(modelErrors).toHaveLength(1);
      expect(memoryErrors[0]).toBe('PERMISSION_DENIED');
      expect(modelErrors[0]).toBe('RATE_LIMITED');
    });
  });

  /**
   * AC7.2: Phase 1 (base + memory + model) delivers value without all subsystems migrated.
   * Test shows that using memory and model errors is valuable even without persistence/agent/config.
   */
  describe('AC7.2: Phase 1 delivers value without full migration', () => {
    // Simulate Phase 1 adoption: memory and model migrated, others not yet
    function phaseOneMemoryRead(id: string): { data: string } | null {
      const store: Record<string, { data: string }> = { 'key-1': { data: 'value' } };
      return store[id] ?? null;
    }

    function phaseOneMemoryWrite(id: string, _data: { data: string }): void {
      const store: Record<string, { data: string }> = { 'key-1': { data: 'value' } };
      if (!store[id]) {
        throw new MemoryError('BLOCK_NOT_FOUND', `block ${id} not found`, { id });
      }
    }

    function phaseOneModelCall(shouldFail: boolean): void {
      if (shouldFail) {
        throw new ModelError('RATE_LIMITED', 'rate limited', true, { retryAfter: 30 });
      }
    }

    function nonMigratedPersistenceFunction(): void {
      // Phase 1 hasn't touched persistence yet — still throws plain Error
      throw new Error('database error');
    }

    it('Phase 1 code provides structured errors for memory', () => {
      let error: MemoryError | null = null;
      try {
        phaseOneMemoryWrite('nonexistent', { data: 'test' });
      } catch (e) {
        if (e instanceof MemoryError) {
          error = e;
        }
      }
      expect(error).toBeDefined();
      expect(error?.code).toBe('BLOCK_NOT_FOUND');
    });

    it('Phase 1 code provides structured errors for model', () => {
      let error: ModelError | null = null;
      try {
        phaseOneModelCall(true);
      } catch (e) {
        if (e instanceof ModelError) {
          error = e;
        }
      }
      expect(error).not.toBeNull();
      expect(error?.code).toBe('RATE_LIMITED');
    });

    it('Phase 1 read operations return null without throwing', () => {
      const result = phaseOneMemoryRead('nonexistent');
      expect(result).toBeNull();
    });

    it('Phase 1 coexists with un-migrated subsystems', () => {
      // Memory: typed error
      let memoryError: MemoryError | null = null;
      try {
        phaseOneMemoryWrite('missing', { data: '' });
      } catch (e) {
        if (e instanceof MemoryError) {
          memoryError = e;
        }
      }

      // Persistence: still plain Error (not migrated)
      let persistenceError: Error | null = null;
      try {
        nonMigratedPersistenceFunction();
      } catch (e) {
        if (e instanceof Error && !(e instanceof ConstellationError)) {
          persistenceError = e;
        }
      }

      expect(memoryError?.code).toBe('BLOCK_NOT_FOUND');
      expect(persistenceError?.message).toBe('database error');
    });
  });

  /**
   * AC7.3: New error types are additive — existing error-throwing code is replaced one function at a time.
   * Test demonstrates that migration is piecemeal: some functions use ConstellationError, others don't yet.
   */
  describe('AC7.3: Additive replacement (one function at a time)', () => {
    // Simulating a module partially migrated
    const memoryModule = {
      // Migrated function: returns T | null
      loadBlock(label: string): { label: string } | null {
        const blocks: Record<string, { label: string }> = { 'goals': { label: 'goals' } };
        return blocks[label] ?? null;
      },

      // Migrated function: throws ConstellationError on write
      updateBlock(label: string): void {
        const blocks: Record<string, boolean> = { 'goals': true };
        if (!blocks[label]) {
          throw new MemoryError('BLOCK_NOT_FOUND', `block ${label} not found`);
        }
      },

      // Not yet migrated: still uses plain Error
      legacyDeleteBlock(label: string): void {
        const blocks: Record<string, boolean> = { 'goals': true };
        if (!blocks[label]) {
          throw new Error(`block ${label} not found`); // not migrated yet
        }
      },
    };

    it('migrated read function returns null for missing', () => {
      const result = memoryModule.loadBlock('nonexistent');
      expect(result).toBeNull();
    });

    it('migrated write function throws ConstellationError', () => {
      let error: MemoryError | null = null;
      try {
        memoryModule.updateBlock('nonexistent');
      } catch (e) {
        if (e instanceof MemoryError) {
          error = e;
        }
      }
      expect(error?.code).toBe('BLOCK_NOT_FOUND');
    });

    it('un-migrated function still throws plain Error', () => {
      let error: Error | null = null;
      try {
        memoryModule.legacyDeleteBlock('nonexistent');
      } catch (e) {
        if (e instanceof Error && !(e instanceof ConstellationError)) {
          error = e;
        }
      }
      expect(error?.message).toContain('block nonexistent not found');
    });

    it('calling code can handle both typed and plain errors in same module', () => {
      const errors: Array<{ type: string; message: string }> = [];

      // Call migrated function
      try {
        memoryModule.updateBlock('missing');
      } catch (e) {
        if (e instanceof MemoryError) {
          errors.push({ type: 'MemoryError', message: e.message });
        }
      }

      // Call un-migrated function
      try {
        memoryModule.legacyDeleteBlock('missing');
      } catch (e) {
        if (e instanceof Error && !(e instanceof ConstellationError)) {
          errors.push({ type: 'Error', message: e.message });
        }
      }

      expect(errors).toHaveLength(2);
      expect(errors[0]?.type).toBe('MemoryError');
      expect(errors[1]?.type).toBe('Error');
    });
  });
});
