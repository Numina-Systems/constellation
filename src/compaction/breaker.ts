// pattern: Functional Core

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type BreakerFault = 'transient' | 'unfittable' | 'intervention';
export type BreakerStatus = Readonly<{
  readonly state: BreakerState;
  readonly consecutiveFailures: number;
  readonly openedAt: number | null;
  readonly interventionRequired: boolean;
}>;

export type BreakerClock = Readonly<{now(): number}>;
export type Breaker = Readonly<{
  allow(): boolean;
  recordSuccess(): void;
  recordFailure(fault: BreakerFault): void;
  reset(): void;
  status(): BreakerStatus;
}>;

export type BreakerOptions = Readonly<{
  readonly threshold: number;
  readonly cooldownMs?: number;
  readonly clock?: BreakerClock;
}>;

/** Circuit breaker with a single half-open probe and a latched intervention state. */
export function createCompactionBreaker(options: BreakerOptions): Breaker {
  const threshold = Math.max(1, Math.floor(options.threshold));
  const cooldownMs = options.cooldownMs ?? 60_000;
  const clock = options.clock ?? {now: () => Date.now()};
  let state: BreakerState = 'CLOSED';
  let consecutiveFailures = 0;
  let openedAt: number | null = null;
  let interventionRequired = false;
  let probeInFlight = false;

  function allow(): boolean {
    if (interventionRequired) return false;
    if (state === 'CLOSED') return true;
    if (state === 'OPEN') {
      if (openedAt === null || clock.now() - openedAt < cooldownMs) return false;
      state = 'HALF_OPEN';
      probeInFlight = false;
    }
    if (state === 'HALF_OPEN') {
      if (probeInFlight) return false;
      probeInFlight = true;
      return true;
    }
    return false;
  }

  function recordSuccess(): void {
    state = 'CLOSED';
    consecutiveFailures = 0;
    openedAt = null;
    probeInFlight = false;
  }

  function recordFailure(fault: BreakerFault): void {
    probeInFlight = false;
    if (fault === 'intervention') {
      interventionRequired = true;
      state = 'OPEN';
      openedAt = clock.now();
      return;
    }
    if (fault === 'unfittable') return;
    consecutiveFailures += 1;
    if (state === 'HALF_OPEN' || consecutiveFailures >= threshold) {
      state = 'OPEN';
      openedAt = clock.now();
    }
  }

  function reset(): void {
    state = 'CLOSED';
    consecutiveFailures = 0;
    openedAt = null;
    interventionRequired = false;
    probeInFlight = false;
  }

  return {allow, recordSuccess, recordFailure, reset, status: () => ({state, consecutiveFailures, openedAt, interventionRequired})};
}
