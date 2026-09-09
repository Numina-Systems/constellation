import {describe, expect, it} from "bun:test";
import {buildRequestBudget, defaultSafetyMargin, resolveContextWindow} from "./budget.js";
import {groupExchanges, shapeExchanges} from "./exchange.js";
import {normalizeAnthropicUsage, normalizeOllamaUsage, normalizeOpenAIUsage, replaceCumulativeUsage} from "./usage.js";
import type {Message} from "./types.js";

function text(role: Message["role"], content: string): Message { return {role, content}; }
function toolMessage(id: string): Message { return {role: "assistant", content: [{type: "tool_use", id, name: "lookup", input: {q: "x"}}]}; }
function resultMessage(id: string): Message { return {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "ok"}]}; }

describe("exchange protocol", () => {
  it("groups calls and correlated results in source order", () => {
    const current = text("user", "objective");
    const grouped = groupExchanges([text("user", "old"), toolMessage("call-1"), resultMessage("call-1"), current], current);
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(grouped.exchanges.map((exchange) => exchange.messages.length)).toEqual([1, 2, 1]);
  });
  it("rejects duplicate, orphan, and missing results", () => {
    expect(groupExchanges([resultMessage("orphan")]).ok).toBe(false);
    expect(groupExchanges([toolMessage("missing")]).ok).toBe(false);
    expect(groupExchanges([toolMessage("dup"), resultMessage("dup"), resultMessage("dup")]).ok).toBe(false);
  });
  it("protects current identity and drops only complete older groups", () => {
    const current = text("user", "same role as older");
    const grouped = groupExchanges([text("user", "old"), current], current);
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(shapeExchanges(grouped.exchanges, 1).map((exchange) => exchange.messages[0]?.content)).toEqual([current.content]);
  });
});

describe("request budget", () => {
  it("uses the specified margin formula and serialized provider shapes", () => {
    expect(defaultSafetyMargin(10000)).toBe(256);
    expect(defaultSafetyMargin(20000)).toBe(400);
    const result = buildRequestBudget({messages: [text("user", "hello")], outputReserve: 10, contextWindow: 1000});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.budget.estimatesAreHeuristic).toBe(true);
  });
  it("reports mandatory context as unfittable and gates separate summarizers", () => {
    const result = buildRequestBudget({messages: [text("user", "x".repeat(5000))], outputReserve: 10, contextWindow: 1400});
    expect(result).toMatchObject({ok: false, code: "context_unfittable"});
    expect(resolveContextWindow({isSummarizer: true, sameModel: false}).diagnostic).toContain("required");
  });
});

describe("usage accounting", () => {
  it("adds Anthropic cache subsets once", () => {
    expect(normalizeAnthropicUsage({input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 7, output_tokens: 2})).toMatchObject({input_tokens: 20, cache_creation_input_tokens: 3, cache_read_input_tokens: 7});
  });
  it("does not add OpenAI cached input twice and preserves reasoning subset", () => {
    expect(normalizeOpenAIUsage({prompt_tokens: 20, completion_tokens: 4, prompt_tokens_details: {cached_tokens: 10}, completion_tokens_details: {reasoning_tokens: 2}})).toEqual({input_tokens: 20, output_tokens: 4, cache_read_input_tokens: 10, reasoning_output_tokens: 2});
  });
  it("keeps cumulative terminal usage as replacement and absent usage absent", () => {
    const first = normalizeOllamaUsage(4, 1);
    const final = normalizeOllamaUsage(9, 3);
    expect(replaceCumulativeUsage(first, final)).toEqual(final);
    expect(replaceCumulativeUsage(first, null)).toEqual(first);
    expect(normalizeOllamaUsage(undefined, undefined)).toBeNull();
  });
});
