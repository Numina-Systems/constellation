import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createAnthropicAdapter} from "./anthropic.js";
import {composeCancellation, classifyCancellation} from "./cancellation.js";
import {createOllamaAdapter} from "./ollama.js";
import {createOpenAICompatAdapter} from "./openai-compat.js";
import {createOpenRouterAdapter} from "./openrouter.js";
import {callWithRetry} from "./retry.js";
import {ModelError} from "./types.js";
import type {ModelConfig} from "../config/schema.js";
import type {ModelProvider, ModelRequest, StreamEvent} from "./types.js";

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

type Gate = {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
};

function createGate(): Gate {
  let resolveGate: () => void = () => {};
  let rejectGate: (reason: unknown) => void = () => {};
  const promise = new Promise<void>((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });
  return {promise, resolve: resolveGate, reject: rejectGate};
}

const PROVIDER_FAMILIES = ["anthropic", "openai-compat", "openrouter", "ollama"] as const;
type ProviderFamily = (typeof PROVIDER_FAMILIES)[number];

function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    messages: [{role: "user", content: "lifetime test"}],
    model: "lifetime-model",
    max_tokens: 20,
    ...overrides,
  };
}

function createAdapter(family: ProviderFamily, baseUrl: string): ModelProvider {
  const config: ModelConfig = family === "anthropic"
    ? {provider: family, name: "lifetime-model", api_key: "fake-anthropic", base_url: baseUrl}
    : family === "openai-compat"
      ? {provider: family, name: "lifetime-model", api_key: "fake-openai", base_url: `${baseUrl}/v1`, stream_usage: true}
      : family === "openrouter"
        ? {provider: family, name: "lifetime-model", api_key: "fake-openrouter", base_url: `${baseUrl}/v1`}
        : {provider: family, name: "lifetime-model", base_url: baseUrl};

  return family === "anthropic"
    ? createAnthropicAdapter(config)
    : family === "openai-compat"
      ? createOpenAICompatAdapter(config)
      : family === "openrouter"
        ? createOpenRouterAdapter(config)
        : createOllamaAdapter(config);
}

type StalledResponse = {
  readonly requestSeen: Promise<void>;
  readonly pushLateEvent: () => void;
  readonly getRequestCount: () => number;
  readonly server: ReturnType<typeof Bun.serve>;
};

function createStalledResponse(family: ProviderFamily): StalledResponse {
  const requestSeen = createGate();
  let requestCount = 0;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const initialChunk = family === "anthropic"
    ? `event: message_start\ndata: ${JSON.stringify({type: "message_start", message: {id: "lifetime", usage: {input_tokens: 1, output_tokens: 0}}})}\n\n`
    : family === "ollama"
      ? `${JSON.stringify({model: "lifetime-model", message: {role: "assistant", content: "partial"}, done: false})}\n`
      : `data: ${JSON.stringify({id: "lifetime", choices: [{delta: {content: "partial"}, finish_reason: null}]})}\n\n`;
  const contentType = family === "ollama" ? "application/x-ndjson" : "text/event-stream";
  const body = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      streamController.enqueue(encoder.encode(initialChunk));
    },
  });

  const server = Bun.serve({
    port: 0,
    fetch: () => {
      requestCount += 1;
      requestSeen.resolve();
      return new Response(body, {headers: {"content-type": contentType}});
    },
  });

  return {
    requestSeen: requestSeen.promise,
    pushLateEvent: () => {
      const lateChunk = family === "ollama"
        ? `${JSON.stringify({model: "lifetime-model", message: {role: "assistant", content: "late"}, done: false})}\n`
        : family === "anthropic"
          ? `event: content_block_delta\ndata: ${JSON.stringify({type: "content_block_delta", index: 0, delta: {type: "text_delta", text: "late"}})}\n\n`
          : `data: ${JSON.stringify({id: "lifetime", choices: [{delta: {content: "late"}, finish_reason: null}]})}\n\n`;
      try {
        controller?.enqueue(encoder.encode(lateChunk));
      } catch {
        // A correctly aborted response has already canceled the underlying body.
      }
    },
    getRequestCount: () => requestCount,
    server,
  };
}

async function expectModelFailure(
  pending: Promise<ReadonlyArray<StreamEvent>>,
  code: "TIMEOUT" | "CANCELLED",
): Promise<void> {
  let error: unknown = null;
  try {
    await pending;
  } catch (candidate) {
    error = candidate;
  }

  expect(error).toBeInstanceOf(ModelError);
  if (error instanceof ModelError) {
    expect(error.code).toBe(code);
    expect(error.retryable).toBe(code === "TIMEOUT");
  }
}

async function expectStalledStreamFailure(
  family: ProviderFamily,
  overrides: Partial<ModelRequest>,
  code: "TIMEOUT" | "CANCELLED",
): Promise<void> {
  const fixture = createStalledResponse(family);
  const adapter = createAdapter(family, `http://localhost:${fixture.server.port}`);
  const events: Array<StreamEvent> = [];
  const firstEvent = createGate();
  const pending = (async (): Promise<ReadonlyArray<StreamEvent>> => {
    try {
      for await (const event of adapter.stream(request(overrides))) {
        events.push(event);
        firstEvent.resolve();
      }
      return events;
    } catch (error) {
      firstEvent.reject(error);
      throw error;
    }
  })();

  try {
    await fixture.requestSeen;
    await firstEvent.promise;
    expect(events.length).toBeGreaterThan(0);
    await expectModelFailure(pending, code);
    const eventCountAtFailure = events.length;

    // A late server chunk must not be consumed after the terminal cancellation.
    fixture.pushLateEvent();
    await Promise.resolve();
    expect(events).toHaveLength(eventCountAtFailure);
    expect(events.some((event) => event.type === "message_stop")).toBe(false);
    expect(fixture.getRequestCount()).toBe(1);
  } finally {
    fixture.server.stop();
  }
}

describe("provider_lifetime_cancellation_matrix", () => {
  let idleServer: ReturnType<typeof Bun.serve> | null = null;

  beforeAll(() => {
    idleServer = Bun.serve({port: 0, fetch: () => new Response("ok")});
  });

  afterAll(() => idleServer?.stop());

  it("composes signal and deadline and classifies deliberate cancellation separately", () => {
    const controller = new AbortController();
    const composed = composeCancellation({signal: controller.signal, deadline: Date.now() + 10_000});
    controller.abort(abortError("caller stopped"));
    expect(composed.signal.aborted).toBe(true);
    expect(classifyCancellation(composed.signal, null)?.reason).toBe("cancelled");
    composed.dispose();
  });

  it("classifies an expired absolute deadline as timeout", () => {
    expect(classifyCancellation(null, 100, 100)).toEqual({reason: "timeout", deadline: 100});
  });

  for (const family of PROVIDER_FAMILIES) {
    it(`${family} cuts a mid-stream request at its absolute deadline`, async () => {
      // The pre-fix adapter ignored deadline-only stream lifetimes; this request also
      // has a generous timeout so the absolute deadline is the winning cancellation.
      await expectStalledStreamFailure(
        family,
        {deadline: Date.now() + 250, timeout: 5_000},
        "TIMEOUT",
      );
    });

    it(`${family} cancels a deadline-only caller with no timeout configured`, async () => {
      // Regression guard for M1: omit timeout entirely. Before deadline composition,
      // this stalled stream stayed pending instead of becoming a typed TIMEOUT.
      await expectStalledStreamFailure(family, {deadline: Date.now() + 250}, "TIMEOUT");
    });
  }

  for (const family of ["anthropic", "openai-compat"] as const) {
    it(`${family} maps deliberate mid-stream AbortSignal to non-retryable CANCELLED`, async () => {
      const fixture = createStalledResponse(family);
      const adapter = createAdapter(family, `http://localhost:${fixture.server.port}`);
      const controller = new AbortController();
      const events: Array<StreamEvent> = [];
      const firstEvent = createGate();
      const pending = (async (): Promise<ReadonlyArray<StreamEvent>> => {
        try {
          for await (const event of adapter.stream(request({signal: controller.signal}))) {
            events.push(event);
            firstEvent.resolve();
          }
          return events;
        } catch (error) {
          firstEvent.reject(error);
          throw error;
        }
      })();

      try {
        await fixture.requestSeen;
        await firstEvent.promise;
        controller.abort(abortError("caller stopped while streaming"));
        await expectModelFailure(pending, "CANCELLED");
        expect(events.some((event) => event.type === "message_stop")).toBe(false);
        const eventCountAtFailure = events.length;
        fixture.pushLateEvent();
        await Promise.resolve();
        expect(events).toHaveLength(eventCountAtFailure);
      } finally {
        fixture.server.stop();
      }
    });
  }

  it("retries transient failures and succeeds within one outer deadline", async () => {
    let attempts = 0;
    let backoffs = 0;
    const result = await callWithRetry(
      async (): Promise<string> => {
        attempts += 1;
        if (attempts < 3) throw new ModelError("PROVIDER_UNAVAILABLE", "transient 500", true);
        return "ok";
      },
      (error: unknown) => error instanceof ModelError && error.retryable,
      undefined,
      {
        deadline: Date.now() + 5_000,
        sleep: async (): Promise<void> => {
          backoffs += 1;
        },
      },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
    expect(backoffs).toBe(2);
  });

  it("classifies a deadline expiring during retry backoff as TIMEOUT, not CANCELLED", async () => {
    const firstAttempt = createGate();
    let attempts = 0;
    const pending = callWithRetry(
      async (): Promise<never> => {
        attempts += 1;
        firstAttempt.resolve();
        throw new ModelError("PROVIDER_UNAVAILABLE", "transient 500", true);
      },
      () => true,
      undefined,
      {deadline: Date.now() + 25},
    );
    await firstAttempt.promise;
    await expect(pending).rejects.toMatchObject({code: "TIMEOUT", retryable: true});
    expect(attempts).toBe(1);
  });

  it("classifies a caller abort during retry backoff as CANCELLED", async () => {
    const firstAttempt = createGate();
    const controller = new AbortController();
    let attempts = 0;
    const pending = callWithRetry(
      async (): Promise<never> => {
        attempts += 1;
        firstAttempt.resolve();
        throw new ModelError("PROVIDER_UNAVAILABLE", "transient 500", true);
      },
      () => true,
      undefined,
      {signal: controller.signal},
    );
    await firstAttempt.promise;
    controller.abort(abortError("caller stopped during retry backoff"));
    await expect(pending).rejects.toMatchObject({code: "CANCELLED", retryable: false});
    expect(attempts).toBe(1);
  });
});
