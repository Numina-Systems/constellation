// pattern: Imperative Shell

import { describe, it, expect } from 'bun:test';
import { createContinuationBudget } from './continuation-budget';

describe('impulse-continuation.AC3: Budget enforcement', () => {
  describe('impulse-continuation.AC3.1: canContinue() returns true when both budgets remain', () => {
    it('fresh budget with maxPerEvent: 2, maxPerCycle: 10 returns true initially', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 10 });
      expect(budget.canContinue()).toBe(true);
    });

    it('fresh budget with maxPerEvent: 2, maxPerCycle: 10 returns true after one spend', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 10 });
      budget.spend();
      expect(budget.canContinue()).toBe(true);
    });
  });

  describe('impulse-continuation.AC3.2: canContinue() returns false when per-event budget exhausted', () => {
    it('budget with maxPerEvent: 1, maxPerCycle: 10 returns false after spending once', () => {
      const budget = createContinuationBudget({ maxPerEvent: 1, maxPerCycle: 10 });
      budget.spend();
      expect(budget.canContinue()).toBe(false);
    });

    it('per-event exhaustion takes precedence even though per-cycle remains', () => {
      const budget = createContinuationBudget({ maxPerEvent: 1, maxPerCycle: 10 });
      budget.spend();
      // per-event is 0, per-cycle is 9
      expect(budget.canContinue()).toBe(false);
    });
  });

  describe('impulse-continuation.AC3.3: canContinue() returns false when per-cycle budget exhausted', () => {
    it('budget with maxPerEvent: 5, maxPerCycle: 1 returns false after spending once', () => {
      const budget = createContinuationBudget({ maxPerEvent: 5, maxPerCycle: 1 });
      budget.spend();
      expect(budget.canContinue()).toBe(false);
    });

    it('per-cycle exhaustion takes precedence even though per-event remains', () => {
      const budget = createContinuationBudget({ maxPerEvent: 5, maxPerCycle: 1 });
      budget.spend();
      // per-event is 4, per-cycle is 0
      expect(budget.canContinue()).toBe(false);
    });
  });

  describe('impulse-continuation.AC3.4: resetEvent() restores per-event budget without affecting per-cycle', () => {
    it('budget with maxPerEvent: 2, maxPerCycle: 5 restores per-event after two spends', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 5 });
      budget.spend();
      budget.spend();
      // per-event exhausted, per-cycle has 3
      expect(budget.canContinue()).toBe(false);

      budget.resetEvent();
      // per-event restored to 2, per-cycle still has 3
      expect(budget.canContinue()).toBe(true);
    });

    it('per-cycle counter reflects correct remaining after resetEvent', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 5 });
      budget.spend();
      budget.spend();
      // per-event exhausted (0), per-cycle has 3 remaining
      budget.resetEvent();
      // per-event restored to 2, per-cycle still has 3

      // Spend 2 times (limited by per-event)
      budget.spend();
      expect(budget.canContinue()).toBe(true);
      budget.spend();
      // per-event exhausted again (0), per-cycle has 1
      expect(budget.canContinue()).toBe(false);

      // Reset event again, per-cycle still has 1
      budget.resetEvent();
      expect(budget.canContinue()).toBe(true);
      budget.spend();
      // per-event exhausted (0), per-cycle exhausted (0)
      expect(budget.canContinue()).toBe(false);
    });
  });

  describe('impulse-continuation.AC3.5: resetCycle() restores both per-event and per-cycle budgets', () => {
    it('budget with maxPerEvent: 2, maxPerCycle: 3 fully restores after resetCycle', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 3 });

      // Exhaust both budgets with resets
      budget.spend();
      budget.spend();
      budget.resetEvent();
      budget.spend();
      // per-event: 1, per-cycle: 0 (exhausted)
      expect(budget.canContinue()).toBe(false);

      budget.resetCycle();
      // Both should be fully restored
      expect(budget.canContinue()).toBe(true);
    });

    it('both counters are fully restored after resetCycle', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 3 });

      // Spend twice (exhausts per-event, per-cycle has 1)
      budget.spend();
      budget.spend();
      expect(budget.canContinue()).toBe(false);

      budget.resetCycle();

      // Both should allow multiple spends again
      budget.spend();
      expect(budget.canContinue()).toBe(true);
      budget.spend();
      // per-event exhausted again (0), per-cycle has 1
      expect(budget.canContinue()).toBe(false);

      budget.resetCycle();
      // per-event: 2, per-cycle: 3
      budget.spend();
      expect(budget.canContinue()).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('zero per-event budget: canContinue() returns false immediately', () => {
      const budget = createContinuationBudget({ maxPerEvent: 0, maxPerCycle: 10 });
      expect(budget.canContinue()).toBe(false);
    });

    it('zero per-cycle budget: canContinue() returns false immediately', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 0 });
      expect(budget.canContinue()).toBe(false);
    });

    it('fresh budget is always ready on construction', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 5 });
      expect(budget.canContinue()).toBe(true);
    });

    it('multiple resets work correctly', () => {
      const budget = createContinuationBudget({ maxPerEvent: 2, maxPerCycle: 3 });

      budget.spend();
      budget.resetEvent();
      budget.spend();
      budget.spend();
      budget.resetEvent();
      budget.spend();
      expect(budget.canContinue()).toBe(false);

      budget.resetCycle();
      expect(budget.canContinue()).toBe(true);
    });
  });
});
