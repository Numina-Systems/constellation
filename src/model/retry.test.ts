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
      const timestamps: Array<number> = [];

      try {
        await callWithRetry(
          async () => {
            timestamps.push(Date.now());
            throw new Error("retry");
          },
          () => true
        );
      } catch {
        // expected to throw
      }

      expect(timestamps.length).toBe(3);

      // Calculate intervals between attempts
      const interval1 = timestamps[1]! - timestamps[0]!;
      const interval2 = timestamps[2]! - timestamps[1]!;

      // First interval should be around 1000ms, second should be around 2000ms
      // Allow 200ms tolerance for test timing variance
      expect(interval1).toBeGreaterThan(800);
      expect(interval2).toBeGreaterThan(1800);
      expect(interval2).toBeGreaterThan(interval1);
    });
  });
});
