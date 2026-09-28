// pattern: Functional Core

export type TestClock = {
  readonly now: () => number;
  readonly advance: (milliseconds: number) => void;
  readonly sleep: (milliseconds: number) => Promise<void>;
};

export function createTestClock(initialTime = 0): TestClock {
  let currentTime = initialTime;
  const waiters: Array<{readonly at: number; readonly resolve: () => void}> = [];
  return {
    now: () => currentTime,
    advance: (milliseconds) => {
      if (!Number.isInteger(milliseconds) || milliseconds < 0) {
        throw new Error('clock advance must be a non-negative integer');
      }
      currentTime += milliseconds;
      for (let index = waiters.length - 1; index >= 0; index -= 1) {
        const waiter = waiters[index];
        if (waiter && waiter.at <= currentTime) {
          waiters.splice(index, 1);
          waiter.resolve();
        }
      }
    },
    sleep: (milliseconds) => {
      if (!Number.isInteger(milliseconds) || milliseconds < 0) {
        return Promise.reject(new Error('clock sleep must be a non-negative integer'));
      }
      if (milliseconds === 0) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.push({at: currentTime + milliseconds, resolve});
      });
    },
  };
}
