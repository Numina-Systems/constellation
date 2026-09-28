import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createAnthropicAdapter} from "./anthropic.js";
import {createOllamaAdapter} from "./ollama.js";
import {createOpenAICompatAdapter} from "./openai-compat.js";
import {createOpenRouterAdapter} from "./openrouter.js";
import type {ModelProvider} from "./types.js";

type Captured = {readonly path: string; readonly body: Record<string, unknown>};

function request(): {readonly model: string; readonly max_tokens: number; readonly messages: Array<{readonly role: "user"; readonly content: string}>} {
  return {model: "wire-model", max_tokens: 8, messages: [{role: "user", content: "wire"}]};
}

async function consume(adapter: ModelProvider): Promise<void> {
  for await (const _event of adapter.stream(request())) {
    // Event consumption is required to make each adapter issue the request and drain its fake stream.
  }
}

describe("provider_wire_contract_matrix", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let captures: Array<Captured> = [];
  let baseUrl = "";

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const body = await request.json() as Record<string, unknown>;
        captures.push({path: new URL(request.url).pathname, body});
        if (new URL(request.url).pathname.endsWith("/messages")) {
          return new Response(`event: message_start\ndata: ${JSON.stringify({type: "message_start", message: {id: "wire", usage: {input_tokens: 0, output_tokens: 0}}})}\n\nevent: message_delta\ndata: ${JSON.stringify({type: "message_delta", delta: {stop_reason: "end_turn"}, usage: {output_tokens: 0}})}\n\n`, {headers: {"content-type": "text/event-stream"}});
        }
        if (new URL(request.url).pathname.endsWith("/api/chat")) {
          return new Response(JSON.stringify({model: "wire-model", message: {role: "assistant", content: "ok"}, done: true}) + "\n", {headers: {"content-type": "application/x-ndjson"}});
        }
        return new Response(`data: ${JSON.stringify({id: "wire", choices: [{delta: {content: "ok"}, finish_reason: "stop"}]})}\n\ndata: [DONE]\n\n`, {headers: {"content-type": "text/event-stream"}});
      },
    });
    baseUrl = `http://localhost:${server.port}`;
  });

  afterAll(() => server?.stop());

  it("keeps Anthropic request payload stable and introduces no cache_control", async () => {
    captures = [];
    await consume(createAnthropicAdapter({provider: "anthropic", name: "wire-model", api_key: "fake", base_url: baseUrl}));
    const body = captures[0]?.body;
    expect(body?.["model"]).toBe("wire-model");
    expect(body).not.toHaveProperty("cache_control");
    expect(JSON.stringify(body)).not.toContain("cache_control");
  });

  it("emits OpenAI stream usage only when explicitly enabled", async () => {
    captures = [];
    await consume(createOpenAICompatAdapter({provider: "openai-compat", name: "wire-model", api_key: "fake", base_url: `${baseUrl}/v1`, stream_usage: true}));
    expect(captures[0]?.body["stream"]).toBe(true);
    expect(captures[0]?.body["stream_options"]).toEqual({include_usage: true});
    captures = [];
    await consume(createOpenAICompatAdapter({provider: "openai-compat", name: "wire-model", api_key: "fake", base_url: `${baseUrl}/v1`, stream_usage: false}));
    expect(captures[0]?.body).not.toHaveProperty("stream_options");
  });

  it("defaults OpenRouter stream usage on and allows explicit disable", async () => {
    captures = [];
    await consume(createOpenRouterAdapter({provider: "openrouter", name: "wire-model", api_key: "fake", base_url: `${baseUrl}/v1`}));
    expect(captures[0]?.body["stream_options"]).toEqual({include_usage: true});
    captures = [];
    await consume(createOpenRouterAdapter({provider: "openrouter", name: "wire-model", api_key: "fake", base_url: `${baseUrl}/v1`, stream_usage: false}));
    expect(captures[0]?.body).not.toHaveProperty("stream_options");
  });

  it("uses Ollama native chat wire shape without OpenAI stream options", async () => {
    captures = [];
    await consume(createOllamaAdapter({provider: "ollama", name: "wire-model", base_url: baseUrl}));
    expect(captures[0]?.path).toBe("/api/chat");
    expect(captures[0]?.body["stream"]).toBe(true);
    expect(captures[0]?.body).not.toHaveProperty("stream_options");
  });
});
