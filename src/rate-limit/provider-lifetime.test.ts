import {describe, expect, it} from "bun:test";
import {createRateLimitedProvider} from "./provider.js";
import {ModelError} from "../model/types.js";
import type {ModelProvider, ModelRequest, ModelResponse} from "../model/types.js";
import type {RateLimiterConfig} from "./types.js";

type Gate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
};

function createGate(): Gate {
  let resolveGate: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolveGate = resolve;
  });
  return {promise, resolve: resolveGate};
}

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [{role: "user", content: "rate-limit lifetime"}],
    model: "rate-limit-model",
    max_tokens: 4,
    ...overrides,
  };
}

function response(): ModelResponse {
  return {
    content: [{type: "text", text: "ok"}],
    stop_reason: "end_turn",
    usage: {input_tokens: 1, output_tokens: 1},
  };
}

function createConfig(overrides: Partial<RateLimiterConfig> = {}): RateLimiterConfig {
  return {
    requestsPerMinute: 100,
    inputTokensPerMinute: 10_000,
    outputTokensPerMinute: 1,
    minOutputReserve: 1,
    ...overrides,
  };
}

describe("rate_limit_provider_lifetime", () => {
  it("fails a deadline-expired rate-limit acquisition before provider invocation", async () => {
    let calls = 0;
    const provider: ModelProvider = {
      complete: async (): Promise<ModelResponse> => {
        calls += 1;
        return response();
      },
      async *stream() {
        // The rate-limit lifetime tests exercise complete(), which is the gated path.
      },
    };
    const rateLimited = createRateLimitedProvider(provider, createConfig());

    await rateLimited.complete(request({messages: [{role: "user", content: "first"}]}));
    const pending = rateLimited.complete(request({
      messages: [{role: "user", content: "queued"}],
      deadline: Date.now() + 25,
    }));

    await expect(pending).rejects.toMatchObject({code: "TIMEOUT", retryable: true});
    expect(calls).toBe(1);
    expect(rateLimited.getStatus().queueDepth).toBe(0);
  });

  it("releases a canceled mutex waiter so a later caller proceeds", async () => {
    const firstStarted = createGate();
    const releaseFirst = createGate();
    const nextStarted = createGate();
    let calls = 0;
    const provider: ModelProvider = {
      complete: async (): Promise<ModelResponse> => {
        calls += 1;
        if (calls === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        } else if (calls === 2) {
          nextStarted.resolve();
        }
        return response();
      },
      async *stream() {
        // The rate-limit lifetime tests exercise complete(), which is the gated path.
      },
    };
    const rateLimited = createRateLimitedProvider(provider, createConfig({outputTokensPerMinute: 10_000}));

    const first = rateLimited.complete(request({messages: [{role: "user", content: "first"}]}));
    await firstStarted.promise;
    const controller = new AbortController();
    const canceled = rateLimited.complete(request({
      messages: [{role: "user", content: "canceled"}],
      signal: controller.signal,
    }));
    const next = rateLimited.complete(request({messages: [{role: "user", content: "next"}]}));

    controller.abort(new DOMException("caller stopped", "AbortError"));
    await expect(canceled).rejects.toMatchObject({code: "CANCELLED", retryable: false});
    releaseFirst.resolve();
    await first;
    await nextStarted.promise;
    await expect(next).resolves.toEqual(response());
    expect(calls).toBe(2);
    expect(rateLimited.getStatus().queueDepth).toBe(0);
  });

  it("preserves typed provider cancellation errors through the rate-limit wrapper", async () => {
    const provider: ModelProvider = {
      complete: async (): Promise<ModelResponse> => {
        throw new ModelError("CANCELLED", "request cancelled", false);
      },
      async *stream() {
        // The wrapper delegates stream() unchanged; complete() verifies typed propagation.
      },
    };
    const rateLimited = createRateLimitedProvider(provider, createConfig({outputTokensPerMinute: 10_000}));

    await expect(rateLimited.complete(request())).rejects.toMatchObject({code: "CANCELLED", retryable: false});
  });
});
