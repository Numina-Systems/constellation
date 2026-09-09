import {describe, expect, it} from "bun:test";
import {normalizeAnthropicUsage, normalizeOllamaUsage, normalizeOpenAIUsage, replaceCumulativeUsage} from "./usage.js";

describe("usage_accounting_no_double_count", () => {
  it("counts Anthropic input plus cache subsets exactly once", () => {
    expect(normalizeAnthropicUsage({input_tokens: 10, cache_creation_input_tokens: 3, cache_read_input_tokens: 7, output_tokens: 4})).toEqual({input_tokens: 20, output_tokens: 4, cache_creation_input_tokens: 3, cache_read_input_tokens: 7});
  });

  it("keeps OpenAI cached prompt tokens included rather than adding them again", () => {
    expect(normalizeOpenAIUsage({prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: {cached_tokens: 8}})).toEqual({input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 8, reasoning_output_tokens: null});
  });

  it("keeps reasoning output as a subset separate from total output", () => {
    expect(normalizeOpenAIUsage({prompt_tokens: 20, completion_tokens: 9, completion_tokens_details: {reasoning_tokens: 4}})).toEqual({input_tokens: 20, output_tokens: 9, cache_read_input_tokens: null, reasoning_output_tokens: 4});
  });

  it("uses the final cumulative event as replacement, never addition", () => {
    const first = normalizeOllamaUsage(10, 2);
    const final = normalizeOllamaUsage(10, 7);
    expect(replaceCumulativeUsage(first, final)).toEqual(final);
    expect(replaceCumulativeUsage(final, null)).toEqual(final);
  });

  it("keeps wholly absent provider usage absent", () => {
    expect(normalizeAnthropicUsage(undefined)).toBeNull();
    expect(normalizeOpenAIUsage(undefined)).toBeNull();
    expect(normalizeOllamaUsage(undefined, undefined)).toBeNull();
  });
});
