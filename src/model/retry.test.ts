// pattern: Imperative Shell

import { describe, it, expect } from "bun:test";
import { callWithRetry } from "./retry.js";

describe("callWithRetry", () => {
  describe("success path", () => {
    it("should call function once if successful on first attempt", async () => {
      let callCount = 0;

      const result = await callWithRetry(
        async () => {
          callCount++;
          return "success";
        },
        () => false
      );

      expect(result).toBe("success");
      expect(callCount).toBe(1);
    });
  });

  describe("retryable errors", () => {
    it("should retry up to 3 times for retryable errors", async () => {
      let callCount = 0;

      try {
        await callWithRetry(
          async () => {
            callCount++;
            throw new Error("retryable error");
          },
          (error) => error instanceof Error && error.message === "retryable error"
        );
      } catch {
        // expected to throw after retries
      }

      expect(callCount).toBe(3);
    });

    it("should succeed after retrying", async () => {
      let callCount = 0;

      const result = await callWithRetry(
        async () => {
          callCount++;
          if (callCount < 2) {
            throw new Error("retry me");
          }
          return "success after retry";
        },
        (error) => error instanceof Error && error.message === "retry me"
      );

      expect(result).toBe("success after retry");
      expect(callCount).toBe(2);
    });

    it("should call onError callback on each retry", async () => {
      const errors: Array<unknown> = [];
      const attempts: Array<number> = [];

      try {
        await callWithRetry(
          async () => {
            throw new Error("always fail");
          },
          () => true,
          (error, attempt) => {
            errors.push(error);
            attempts.push(attempt);
          }
        );
      } catch {
        // expected to throw
      }

      expect(errors.length).toBe(3);
      expect(attempts).toEqual([0, 1, 2]);
    });
  });

  describe("non-retryable errors", () => {
    it("should throw immediately for non-retryable errors", async () => {
      let callCount = 0;

      try {
        await callWithRetry(
          async () => {
            callCount++;
            throw new Error("non-retryable");
          },
          () => false
        );
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("non-retryable");
      }

      expect(callCount).toBe(1);
    });
  });

  describe("backoff timing", () => {
    it("should increase backoff with exponential growth", async () => {
      const delays: Array<number> = [];
      let calls = 0;

      try {
        await callWithRetry(
          async () => {
            calls += 1;
            throw new Error("retry");
          },
          () => true,
          undefined,
          {random: () => 0.75, sleep: async ms => { delays.push(ms); }}
        );
      } catch {
        // expected to throw
      }

      expect(calls).toBe(3);
      expect(delays).toEqual([750, 1_500]);
    });
  });

  describe("Retry-After and jitter", () => {
    it("honors seconds and HTTP-date Retry-After headers with a 60-second cap", async () => {
      const delays: Array<number> = [];
      const retry = async (header: string): Promise<void> => {
        let calls = 0;
        await expect(callWithRetry(async () => {
          calls += 1;
          if (calls === 1) throw Object.assign(new Error("rate limited"), {status: 429, headers: new Headers({"retry-after": header})});
          return "ok";
        }, () => true, undefined, {sleep: async ms => { delays.push(ms); }, random: () => 0.5})).resolves.toBe("ok");
      };
      await retry("2");
      await retry(new Date(Date.now() + 5_000).toUTCString());
      await retry("3600");
      expect(delays[0]).toBe(2_000);
      expect(delays[1]).toBeGreaterThan(0);
      expect(delays[1]).toBeLessThanOrEqual(5_000);
      expect(delays[2]).toBe(60_000);
    });

    it("falls back to jittered backoff for Retry-After zero", async () => {
      const delays: Array<number> = [];
      let calls = 0;
      await expect(callWithRetry(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("rate limited"), {status: 429, headers: new Headers({"retry-after": "0"})});
        return "ok";
      }, () => true, undefined, {random: () => 0.5, sleep: async ms => { delays.push(ms); }})).resolves.toBe("ok");
      expect(calls).toBe(2);
      expect(delays).toEqual([500]);
    });

    it("falls back to jittered backoff for a stale Retry-After HTTP-date", async () => {
      const delays: Array<number> = [];
      let calls = 0;
      await expect(callWithRetry(async () => {
        calls += 1;
        if (calls === 1) throw Object.assign(new Error("rate limited"), {status: 429, headers: new Headers({"retry-after": "Wed, 21 Oct 2015 07:28:00 GMT"})});
        return "ok";
      }, () => true, undefined, {random: () => 0.25, sleep: async ms => { delays.push(ms); }})).resolves.toBe("ok");
      expect(calls).toBe(2);
      expect(delays).toEqual([250]);
    });

    it("stops before retry when the deadline has expired", async () => {
      let calls = 0;
      await expect(callWithRetry(async () => {
        calls += 1;
        throw Object.assign(new Error("rate limited"), {status: 429, headers: new Headers({"retry-after": "0"})});
      }, () => true, undefined, {deadline: Date.now(), random: () => 0.5, sleep: async () => {}})).rejects.toMatchObject({code: "TIMEOUT"});
      expect(calls).toBe(0);
    });

    it("applies bounded deterministic jitter and respects deadline", async () => {
      const delays: Array<number> = [];
      let calls = 0;
      await expect(callWithRetry(async () => { calls += 1; throw new Error("retry"); }, () => true, undefined, {
        random: () => 0.25,
        sleep: async ms => { delays.push(ms); },
        deadline: Date.now() + 10_000,
      })).rejects.toThrow("retry");
      expect(calls).toBe(3);
      expect(delays).toEqual([250, 500]);
    });
  });

  describe("shared retry classifier", () => {
    it("preserves transient provider errors and rejects permanent errors", async () => {
      const {isRetryableModelError} = await import("./retry.js");
      const cases: Array<[unknown, boolean]> = [
        [Object.assign(new Error("rate limit"), {status: 429}), true],
        [Object.assign(new Error("server"), {status: 503}), true],
        [new Error("API timeout"), true],
        [new Error("connect ECONNREFUSED"), true],
        [new Error("fetch failed: network error"), true],
        [Object.assign(new Error("refused"), {code: "ECONNREFUSED"}), true],
        [Object.assign(new Error("unauthorized"), {status: 401}), false],
        [new Error("invalid input"), false],
        [new Error("user abort"), false],
      ];
      for (const [error, expected] of cases) expect(isRetryableModelError(error)).toBe(expected);
    });
  });
});
