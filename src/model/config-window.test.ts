import {describe, expect, it} from "bun:test";
import {buildRequestBudget, resolveContextWindow} from "./budget.js";

describe("context window configuration", () => {
  it("prefers explicit model windows", () => {
    expect(resolveContextWindow({explicit: 8192, legacyMaxContextTokens: 200000}).window).toBe(8192);
  });
  it("warns when falling back to operator-configured legacy capacity", () => {
    const result = resolveContextWindow({legacyMaxContextTokens: 200000});
    expect(result.window).toBe(200000);
    expect(result.warning).toContain("not verified");
  });
  it("inherits only for an identical summarizer", () => {
    expect(resolveContextWindow({isSummarizer: true, sameModel: true, inferenceWindow: 8192}).window).toBe(8192);
    expect(resolveContextWindow({isSummarizer: true, sameModel: false, inferenceWindow: 8192}).window).toBeNull();
  });
  it("rejects reserve and margin that cannot fit", () => {
    expect(buildRequestBudget({messages: [], outputReserve: 80, safetyMargin: 30, contextWindow: 100})).toMatchObject({ok: false, code: "invalid_reserve"});
  });
});
