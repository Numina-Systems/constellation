import {describe, expect, it} from "bun:test";
import {classifyCancellation, composeCancellation, remainingDeadline} from "./cancellation.js";
import {callWithRetry} from "./retry.js";

describe("provider lifetime contracts", () => {
  it("distinguishes deliberate cancellation from an expired deadline", () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyCancellation(controller.signal, null, 1)?.reason).toBe("cancelled");
    expect(classifyCancellation(null, 10, 10)?.reason).toBe("timeout");
    expect(remainingDeadline(100, 40)).toBe(60);
  });
  it("composes caller signal and timeout and disposes listener/timer", async () => {
    const controller = new AbortController();
    const composed = composeCancellation({signal: controller.signal, timeout: 1000});
    expect(composed.signal.aborted).toBe(false);
    controller.abort();
    expect(composed.signal.aborted).toBe(true);
    composed.dispose();
  });
  it("honors the outer deadline during retry backoff", async () => {
    let calls = 0;
    await expect(callWithRetry(async () => { calls += 1; throw new Error("retry"); }, () => true, undefined, {deadline: Date.now() + 10})).rejects.toThrow("timed out");
    expect(calls).toBe(1);
  });
});
