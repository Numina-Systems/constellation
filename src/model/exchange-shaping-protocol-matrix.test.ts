import {describe, expect, it} from "bun:test";
import {buildRequestBudget} from "./budget.js";
import {groupExchanges, shapeExchanges} from "./exchange.js";
import type {Message} from "./types.js";

function text(role: Message["role"], content: string): Message { return {role, content}; }
function call(id: string): Message { return {role: "assistant", content: [{type: "tool_use", id, name: "lookup", input: {q: id}}]}; }
function result(id: string): Message { return {role: "user", content: [{type: "tool_result", tool_use_id: id, content: "ok"}]}; }

describe("exchange_shaping_protocol_matrix", () => {
  it("keeps assistant tool calls and all correlated results indivisible and ordered", () => {
    const current = text("user", "current");
    const grouped = groupExchanges([text("user", "old"), call("a"), result("a"), current], current);
    expect(grouped.ok).toBe(true);
    if (grouped.ok) {
      expect(grouped.exchanges.map((exchange) => exchange.messages)).toEqual([[text("user", "old")], [call("a"), result("a")], [current]]);
      expect(shapeExchanges(grouped.exchanges, 2).map((exchange) => exchange.messages.length)).toEqual([1, 1]);
    }
  });

  it("rejects duplicate, orphan, and missing tool results before shaping", () => {
    expect(groupExchanges([result("orphan")])).toMatchObject({ok: false, error: {code: "orphan_tool_result"}});
    expect(groupExchanges([call("missing")])).toMatchObject({ok: false, error: {code: "missing_tool_result"}});
    expect(groupExchanges([call("duplicate"), result("duplicate"), result("duplicate")])).toMatchObject({ok: false, error: {code: "duplicate_tool_result"}});
  });

  it("protects the identity-matched current message rather than every same-role message", () => {
    const older = text("user", "same role");
    const current = text("user", "same role");
    const grouped = groupExchanges([older, current], current);
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(shapeExchanges(grouped.exchanges, 1).map((exchange) => exchange.messages[0])).toEqual([current]);
  });

  it("drops only complete older groups and preserves source order", () => {
    const current = text("user", "objective");
    const grouped = groupExchanges([text("user", "one"), call("x"), result("x"), text("user", "two"), current], current);
    expect(grouped.ok).toBe(true);
    if (grouped.ok) expect(shapeExchanges(grouped.exchanges, 2).flatMap((exchange) => exchange.messages.map((message) => message.content))).toEqual([text("user", "two").content, current.content]);
  });

  it("returns context_unfittable without a provider-call-shaped result", () => {
    const budget = buildRequestBudget({messages: [text("user", "x".repeat(5000))], outputReserve: 10, contextWindow: 1400});
    expect(budget).toMatchObject({ok: false, code: "context_unfittable"});
  });
});
