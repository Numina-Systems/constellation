// pattern: Imperative Shell

type ContinuationBudgetConfig = {
  readonly maxPerEvent: number;
  readonly maxPerCycle: number;
};

type ContinuationBudget = {
  readonly canContinue: () => boolean;
  readonly spend: () => void;
  readonly resetEvent: () => void;
  readonly resetCycle: () => void;
};

function createContinuationBudget(config: Readonly<ContinuationBudgetConfig>): ContinuationBudget {
  let eventRemaining = config.maxPerEvent;
  let cycleRemaining = config.maxPerCycle;

  return {
    canContinue() {
      return eventRemaining > 0 && cycleRemaining > 0;
    },

    spend() {
      eventRemaining -= 1;
      cycleRemaining -= 1;
    },

    resetEvent() {
      eventRemaining = config.maxPerEvent;
    },

    resetCycle() {
      eventRemaining = config.maxPerEvent;
      cycleRemaining = config.maxPerCycle;
    },
  };
}

export type { ContinuationBudgetConfig, ContinuationBudget };
export { createContinuationBudget };
