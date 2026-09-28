# Cache-Friendliness Phase 6: Anthropic cache_control Breakpoints

**Goal:** Enable Anthropic prompt caching (it is opt-in per request) by setting `cache_control: {type: "ephemeral"}` breakpoints on the system prompt and the last message.

**Architecture:** The Anthropic adapter (src/model/anthropic.ts) currently sends no `cache_control` anywhere, so Anthropic runs get zero prompt caching. Anthropic renders the prompt as `tools → system → messages`; a breakpoint on the system param's final block caches tools + system together, and a breakpoint on the final message's final content block caches the conversation incrementally (earlier breakpoints remain valid read points as the conversation grows). Two breakpoints total — within Anthropic's limit of 4. Prefixes below the model-dependent minimum (e.g. 4096 tokens on Opus-tier) silently don't cache; that's expected and harmless.

**Tech Stack:** Bun, TypeScript 5.7+ strict, `@anthropic-ai/sdk ^0.39.0` (supports `cache_control` on system blocks and message content blocks), `bun:test`.

**Scope:** Phase 6 of 6 from `docs/design-plans/2026-07-02-cache-friendliness.md`. Independent of Phases 1-5 (touches only the model adapter), but sequenced last because the prefix-stability phases are what make the cached prefix actually reusable.

**Codebase verified:** 2026-07-02 (codebase-investigator). Anthropic caching semantics: prompt-caching reference (prefix match, render order tools→system→messages, max 4 breakpoints, ephemeral 5-min TTL, minimum cacheable prefix, cache-read/write usage fields).

---

## Acceptance Criteria Coverage

This phase implements and tests:

### cache-friendliness.AC6: Anthropic caching enabled
- **cache-friendliness.AC6.1 Success:** Anthropic requests with a system prompt set `cache_control: {type: "ephemeral"}` on the system parameter's final block and on the final content block of the final message.
- **cache-friendliness.AC6.2 Success:** Requests without a system prompt omit the system breakpoint and remain schema-valid (no empty system param).
- **cache-friendliness.AC6.3 Success:** At most 2 breakpoints are added per request (within Anthropic's limit of 4).

---

## Context for the implementor

**Verified current state:**
- `buildAnthropicSystemParam` (src/model/anthropic.ts:32-57) concatenates system-role messages + `request.system` into a plain STRING. It is part of the module's exposed API (see `src/model/CLAUDE.md` "Exposes"). `cache_control` requires the system param to be a block array (`[{type: 'text', text, cache_control?}]`) — the SDK accepts `string | TextBlockParam[]`.
- `normalizeMessage` (src/model/anthropic.ts:115-151) converts internal `Message`s to SDK `MessageParam`s; it throws on system-role messages (they must be extracted first) — that invariant stays.
- Both `complete()` and `stream()` build their own request params — apply the breakpoints in ONE shared place so both paths get them (introduce a shared param-builder if the two code paths currently duplicate construction; verify the exact structure before refactoring).
- `normalizeUsage` (lines 91-96) already surfaces `cache_creation_input_tokens` / `cache_read_input_tokens` — no changes needed to read the results.
- `src/model/anthropic.test.ts` exists; its integration tests skip without `ANTHROPIC_API_KEY`. Request-shape assertions belong in Functional Core tests against the exported pure helpers — do not require an API key for AC6 tests.
- Testing conventions: `bun:test`, plain `expect`, AC-prefixed names, pattern annotations.

**Design decisions (D6):**
- System breakpoint: `buildAnthropicSystemParam` returns `Array<{type: 'text'; text: string; cache_control?: {type: 'ephemeral'}}> | undefined` — a single text block carrying the concatenated system text with `cache_control` set, or `undefined` when there is no system content (adapter then omits the `system` param entirely).
- Message breakpoint: a new pure helper `applyCacheControlToLastBlock(messages)` marks the final content block of the final `MessageParam`: string content is converted to `[{type: 'text', text, cache_control}]`; array content gets `cache_control` on its last block (works for `text` and `tool_result` blocks alike — both accept it).
- Non-Anthropic adapters (openai-compat, ollama) are untouched — their providers cache implicitly.
- Known accepted limitation (do not solve here): Anthropic's breakpoint lookback is 20 content blocks; a single tool-heavy turn adding >20 blocks can miss the previous cache entry. Document it in the module docs; revisit only if observed.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->
<!-- START_TASK_1 -->
### Task 1: Write the failing tests for the pure helpers

**Verifies:** cache-friendliness.AC6.1, cache-friendliness.AC6.2, cache-friendliness.AC6.3

**Files:**
- Modify: `src/model/anthropic.test.ts` (add a `describe('cache_control breakpoints', ...)` block of unit tests — no API key, no SDK client)

**Step 1: Write the tests**

Against `buildAnthropicSystemParam` (existing export, new return type) and `applyCacheControlToLastBlock` (new export):

- **cache-friendliness.AC6.1:** `buildAnthropicSystemParam` with system content returns a block array whose final block has `cache_control: {type: 'ephemeral'}` and whose `text` equals the previous string-concatenation result (same joining behaviour as today — assert against a case with both `request.system` and an inline system-role message to pin the concatenation). `applyCacheControlToLastBlock` on `[{role:'user', content:'hi'}]` returns a last message whose content is `[{type:'text', text:'hi', cache_control:{type:'ephemeral'}}]`; on a last message with block-array content (e.g. ending in a `tool_result` block) only the LAST block gains `cache_control`.
- **cache-friendliness.AC6.2:** No system content → `buildAnthropicSystemParam` returns `undefined` (not `''`, not an empty array).
- **cache-friendliness.AC6.3:** Count occurrences of `cache_control` in `JSON.stringify` of a fully-built request-param object (system + messages helpers applied to a multi-message conversation): exactly 2 with a system prompt, exactly 1 without. Non-final messages carry none.

**Step 2: Run to verify failure**

Run: `bun test src/model/anthropic.test.ts -t "AC6"`
Expected: FAIL (helpers don't exist / return string).
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Implement the breakpoints

**Verifies:** cache-friendliness.AC6.1, cache-friendliness.AC6.2, cache-friendliness.AC6.3

**Files:**
- Modify: `src/model/anthropic.ts`

**Implementation:**

1. Change `buildAnthropicSystemParam` to return the block-array-or-undefined shape (Context section above). Keep the extraction/concatenation logic byte-identical; only the wrapping changes.
2. Add `applyCacheControlToLastBlock` as an exported pure function:

```typescript
export function applyCacheControlToLastBlock(
  messages: Array<Anthropic.MessageParam>,
): Array<Anthropic.MessageParam> {
  if (messages.length === 0) {
    return messages;
  }
  const last = messages[messages.length - 1]!;
  const ephemeral = { type: 'ephemeral' as const };
  const content =
    typeof last.content === 'string'
      ? [{ type: 'text' as const, text: last.content, cache_control: ephemeral }]
      : last.content.map((block, i) =>
          i === last.content.length - 1 ? { ...block, cache_control: ephemeral } : block,
        );
  return [...messages.slice(0, -1), { ...last, content }];
}
```

Adjust the exact SDK type names to what the installed `@anthropic-ai/sdk@^0.39.0` exports (`Anthropic.MessageParam`, `Anthropic.TextBlockParam` — let the compiler confirm; if a block union member rejects `cache_control`, consult the SDK's `.d.ts` for the correct param-side union rather than casting to `any`).

3. Apply both in the request construction used by BOTH `complete()` and `stream()`: system param set only when `buildAnthropicSystemParam` returned a value (omit the key otherwise), messages passed through `applyCacheControlToLastBlock` after normalization. If the two methods duplicate param construction, extract a shared `buildRequestParams(request)` first — a mechanical refactor; keep it in this file.

4. Update the module-level docs/comments; note the 20-block lookback limitation.

**Verification:**
Run: `bun test src/model/anthropic.test.ts -t "AC6"`
Expected: PASS.
Run: `bun run build`
Expected: clean.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Full model suite, docs, commit

**Verifies:** cache-friendliness.AC6.1-AC6.3 (regression)

**Step 1: Run the model suite**

Run: `bun test src/model/`
Expected: all pass (integration tests skip without `ANTHROPIC_API_KEY`; if the key is available in the environment, the live tests exercise the new params against the real API — a schema error here means the SDK types were satisfied but the wire shape wasn't; fix before committing).

**Step 2: Update `src/model/CLAUDE.md`**

Document: `buildAnthropicSystemParam` returns a cache-controlled block array or undefined; the adapter sets 2 ephemeral breakpoints (system final block, last message final block); usage fields already expose cache read/write tokens. Update "Last verified".

**Step 3: Commit**

```bash
git add src/model/anthropic.ts src/model/anthropic.test.ts src/model/CLAUDE.md
git commit -m "feat(model): enable Anthropic prompt caching via cache_control breakpoints"
```
<!-- END_TASK_3 -->
<!-- END_SUBCOMPONENT_A -->
