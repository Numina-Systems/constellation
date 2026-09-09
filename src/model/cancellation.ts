// pattern: Mixed (needs refactoring)
// Pure cancellation classification and imperative signal composition are colocated to keep adapter lifetime handling consistent.

export type CancellationReason = "cancelled" | "timeout";
export type CancellationState = {readonly reason: CancellationReason; readonly deadline: number | null};

export function remainingDeadline(deadline: number | null, now: number = Date.now()): number | null { return deadline === null ? null : Math.max(0, deadline - now); }

export function classifyCancellation(signal: AbortSignal | null, deadline: number | null, now: number = Date.now()): CancellationState | null {
  if (deadline !== null && now >= deadline) return {reason: "timeout", deadline};
  if (signal?.aborted) return {reason: "cancelled", deadline};
  return null;
}

export type ComposedSignal = {
  readonly signal: AbortSignal;
  readonly deadline: number | null;
  readonly dispose: () => void;
};

/** Builds SDK request options without ever passing an undefined timeout. */
export function buildCancellationRequestOptions(
  cancellation: ComposedSignal,
): {readonly signal: AbortSignal; readonly timeout?: number} {
  const remaining = remainingDeadline(cancellation.deadline);
  return {
    signal: cancellation.signal,
    ...(remaining === null ? {} : {timeout: Math.max(1, Math.ceil(remaining))}),
  };
}

export function isTimeoutCancellation(signal: AbortSignal | null | undefined, deadline: number | null | undefined): boolean {
  return (deadline !== null && deadline !== undefined && Date.now() >= deadline)
    || (signal?.reason instanceof DOMException && signal.reason.name === "TimeoutError");
}

/** Composes caller cancellation and an absolute deadline; dispose always detaches listeners/timers. */
export function composeCancellation(options: Readonly<{signal?: AbortSignal; deadline?: number | null; timeout?: number}>): ComposedSignal {
  const controller = new AbortController();
  const signal = options.signal;
  const deadline = options.deadline ?? null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abort = (): void => controller.abort(new DOMException("request cancelled", "AbortError"));
  if (signal) {
    if (signal.aborted) controller.abort(new DOMException("request cancelled", "AbortError"));
    else signal.addEventListener("abort", abort, {once: true});
  }
  const timeoutDeadline = options.timeout === undefined ? null : Date.now() + options.timeout;
  const effectiveDeadline = deadline === null ? timeoutDeadline : timeoutDeadline === null ? deadline : Math.min(deadline, timeoutDeadline);
  if (!controller.signal.aborted && effectiveDeadline !== null) {
    const delay = Math.max(0, effectiveDeadline - Date.now());
    timer = setTimeout(() => controller.abort(new DOMException("request timed out", "TimeoutError")), delay);
  }
  return {signal: controller.signal, deadline: effectiveDeadline, dispose: () => { if (signal) signal.removeEventListener("abort", abort); if (timer !== null) clearTimeout(timer); }};
}
