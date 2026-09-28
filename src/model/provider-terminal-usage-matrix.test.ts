import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createAnthropicAdapter} from "./anthropic.js";
import {createOllamaAdapter} from "./ollama.js";
import {createOpenAICompatAdapter} from "./openai-compat.js";
import {createOpenRouterAdapter} from "./openrouter.js";
import {normalizeAnthropicUsage} from "./usage.js";
import type {ModelConfig} from "../config/schema.js";
import type {ModelProvider, StreamEvent} from "./types.js";

function request(): {readonly model: string; readonly max_tokens: number; readonly messages: Array<{readonly role: "user"; readonly content: string}>} {
  return {model: "test-model", max_tokens: 20, messages: [{role: "user", content: "hello"}]};
}

describe("provider_terminal_usage_matrix", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl = "";

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: (request) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith("/messages")) {
          const events = [
            `event: message_start\ndata: ${JSON.stringify({type: "message_start", message: {id: "anthropic-terminal", usage: {input_tokens: 11, output_tokens: 0, cache_creation_input_tokens: 2, cache_read_input_tokens: 3}}})}\n\n`,
            `event: message_delta\ndata: ${JSON.stringify({type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 4}})}\n\n`,
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
          ].join("");
          return new Response(events, {headers: {"content-type": "text/event-stream"}});
        }
        if (path.endsWith("/api/chat")) {
          const body = [
            {model: "test-model", message: {role: "assistant", content: "ok"}, done: false, prompt_eval_count: 0, eval_count: 0},
            {model: "test-model", message: {role: "assistant", content: ""}, done: true, done_reason: "stop", prompt_eval_count: 11, eval_count: 4},
          ].map((chunk) => JSON.stringify(chunk)).join("\n") + "\n";
          return new Response(body, {headers: {"content-type": "application/x-ndjson"}});
        }
        const chunks = [
          {id: "openai-terminal", object: "chat.completion.chunk", choices: [{delta: {content: "ok"}, finish_reason: null}]},
          {id: "openai-terminal", object: "chat.completion.chunk", choices: [{delta: {}, finish_reason: "stop"}]},
          {id: "openai-terminal", object: "chat.completion.chunk", choices: [], usage: {prompt_tokens: 11, completion_tokens: 4, total_tokens: 15, prompt_tokens_details: {cached_tokens: 3}}},
        ].map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";
        return new Response(chunks, {headers: {"content-type": "text/event-stream"}});
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server?.stop());

  const providerNames: ReadonlyArray<string> = ["Anthropic", "OpenAI-compatible", "OpenRouter", "Ollama"];

  for (const providerName of providerNames) {
    it(`${providerName} exposes final cumulative terminal usage exactly once`, async () => {
      const provider = providerName === "Anthropic"
        ? "anthropic"
        : providerName === "OpenAI-compatible"
          ? "openai-compat"
          : providerName === "OpenRouter"
            ? "openrouter"
            : "ollama";
      const config: ModelConfig = provider === "anthropic"
        ? {provider, name: "test-model", api_key: "fake-anthropic", base_url: baseUrl}
        : provider === "openai-compat"
          ? {provider, name: "test-model", api_key: "fake-openai", base_url: `${baseUrl}/v1`, stream_usage: true}
          : provider === "openrouter"
            ? {provider, name: "test-model", api_key: "fake-openrouter", base_url: `${baseUrl}/v1`}
            : {provider, name: "test-model", base_url: baseUrl};
      const adapter: ModelProvider = provider === "anthropic"
        ? createAnthropicAdapter(config)
        : provider === "openai-compat"
          ? createOpenAICompatAdapter(config)
          : provider === "openrouter"
            ? createOpenRouterAdapter(config)
            : createOllamaAdapter(config);
      const events: Array<StreamEvent> = [];
      for await (const event of adapter.stream(request())) events.push(event);
      const terminalEvents = events.filter((event) => event.type === "message_stop");
      expect(terminalEvents).toHaveLength(1);
      const terminal = terminalEvents[0];
      expect(terminal?.type).toBe("message_stop");
      if (terminal?.type === "message_stop") {
        const expected = provider === "anthropic"
          ? {input_tokens: 16, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 3}
          : provider === "ollama"
            ? {input_tokens: 11, output_tokens: 4}
            : {input_tokens: 11, output_tokens: 4, cache_read_input_tokens: 3};
        expect(terminal.message.usage).toEqual(expected);
      }
    });
  }

  it("does not fabricate usage when the normalized provider usage is absent", () => {
    const usage = normalizeAnthropicUsage(undefined);
    const terminal = {stop_reason: "end_turn", ...(usage ? {usage} : {})};
    expect(terminal).not.toHaveProperty("usage");
  });
});
