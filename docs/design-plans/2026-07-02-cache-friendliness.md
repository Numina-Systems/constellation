# Cache-Friendliness Fixes — Design

Slug: `cache-friendliness`
Date: 2026-07-02
Status: validated (findings verified against working tree during review session)

## Context

Constellation's context-assembly architecture is deliberately cache-aware: the system
prompt is built from core memory only, dynamic context (recall, activity, predictions,
scheduling) routes through batch-anchored snapshots (`src/agent/snapshot.ts`) into
attachments on the latest user message, and cache-bust diagnostics
(`src/agent/cache-diagnostics.ts`) hash four dimensions per request. The daemon runs
primarily against OpenAI-compatible, Ollama, and OpenRouter providers, all of which cache
implicitly (or reuse KV cache) on byte-identical prompt prefixes. Prefix stability is
therefore the whole game.

A caching review found three leaks that defeat the architecture, one dead code path, and
one missing opt-in:

1. **Skills bust the system prompt every turn.** `agent.ts` (~line 300) appends
   semantically-retrieved skill sections directly to the system prompt, keyed on the
   current user message. On OpenAI-compat/Ollama the system prompt is `messages[0]`, so
   the entire conversation prefix is invalidated whenever the skill set shifts. This is
   an acknowledged known limitation with a remediation sketch in the code comment.
2. **Working memory is the first conversation message.** `context.ts` `buildMessages`
   prepends working-memory blocks as a user message at index 0. Working memory is the
   frequently-written tier; every write rewrites `messages[0]` and invalidates
   everything after it.
3. **Snapshot attachments are request-time-only.** `buildUserMessage` composes
   `[attachment, text]` onto the last user message at request time; the persisted history
   keeps the plain string. Replay on the next turn differs byte-for-byte, so the
   provider's cache misses from that message onward every turn. Related: `computeSnapshot`
   runs every round but its output is discarded when the last message is not a plain
   user string (tool rounds) — provider deltas are marked seen and silently dropped.
4. **Diagnostics blind spot.** `computeMessagePrefixState` excludes the last message from
   hashing, so the composed-vs-replayed mismatch in (3) is structurally undetectable.
5. **Anthropic caching is never enabled.** Anthropic prompt caching is opt-in via
   `cache_control` breakpoints; the adapter (`src/model/anthropic.ts`) never sets them,
   so runs against Anthropic (direct or via OpenRouter) get zero caching.

## Goals

- System prompt is byte-stable across turns unless core memory or the diary changes.
- The conversation message list, as replayed from history, is byte-identical to what was
  previously sent (append-only growth, compaction aside).
- Dynamic per-turn content (skills, working memory, recall, activity, …) rides the
  snapshot pipeline at the end of the prompt.
- Diagnostics can detect every class of prefix bust, including last-message recomposition.
- Anthropic runs get explicit cache breakpoints.

## Non-Goals

- No provider-specific cache keys (`prompt_cache_key` etc.).
- No change to compaction semantics (compaction legitimately rewrites the prefix and is
  already suppressed in diagnostics).
- No change to skill retrieval ranking/thresholds — only to where the content is injected.

## Design Decisions

- **D1 — Skills become a dynamic snapshot provider.** Follow the remediation sketch in
  the existing `agent.ts` comment: a `SkillsContextState` holder (mirroring
  `RecallContextState` in `src/recall/context.ts`), created in the composition root,
  registered as a `classification: 'dynamic'` provider, populated in the agent loop after
  `getRelevant()`. The direct `systemPrompt +=` mutation is removed.
- **D2 — Working memory becomes a dynamic snapshot provider.** Remove the prepend from
  `buildMessages`; register a provider that formats working blocks (same `## label\n
  content` shape). Change detection is inherent to the snapshot hash mechanism. Empty
  working memory → provider returns `undefined` → no section.
- **D3 — Composed user messages are persisted as sent.** `buildUserMessage` composes a
  single string (`attachment + "\n\n" + text`) instead of a content-block array, so the
  existing `messages.content` TEXT column holds exactly what was sent, and replay via
  `buildMessages` is byte-identical. After composition, the persisted user-message row is
  updated to the composed content before the model call.
- **D4 — Snapshots are consumed only when deliverable.** `computeSnapshot` (which
  advances `previousHashes`) is called only when the last message is a plain user string
  that can carry the attachment. Provider changes during tool rounds are therefore
  delivered on the next composable turn instead of being dropped.
- **D5 — Diagnostics hash the full message list.** `computeMessagePrefixState` hashes all
  messages; comparison checks that the previous full list is a hash-prefix of the current
  list. Append-only growth → no event; any rewrite of a previously-sent message
  (including the former last message) → `message_prefix` bust event.
- **D6 — Anthropic breakpoints: system + last message.** The adapter sets
  `cache_control: {type: 'ephemeral'}` on the system parameter's final block and on the
  last content block of the final message (2 of the allowed 4 breakpoints). Tools are
  covered implicitly (tools render before system in Anthropic's prefix order).

## Phases

<!-- START_PHASE_1 -->
### Phase 1 — Remove the stale recall system-prompt rebuild

`agent.ts` ~277–283 rebuilds the system prompt "with recall context now set", but
`buildSystemPrompt()` reads only core memory blocks and never consults
`recallContextState`; recall reaches the model via the snapshot pipeline. The rebuild is
a no-op with a misleading comment.

Done when: the rebuild and its comment are gone, recall still reaches the model via the
snapshot attachment, and all existing agent/recall tests pass.
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2 — Route skills through the snapshot pipeline

Implements D1. New `SkillsContextState` holder + provider registration in `index.ts`;
agent loop populates the holder instead of mutating the system prompt.

Done when: with skills enabled, the system prompt is byte-identical across turns (core
memory/diary unchanged), skill content arrives via the dynamic-context attachment, and
tests pass.
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3 — Route working memory through the snapshot pipeline

Implements D2. Remove the prepend in `buildMessages`; add a working-memory dynamic
provider in `index.ts`.

Done when: `buildMessages` output derives solely from history, working-memory content
arrives via the dynamic-context attachment, a working-memory write produces a delta on
the next composition rather than rewriting `messages[0]`, and tests pass.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4 — Persist composed user messages; consume snapshots only when deliverable

Implements D3 and D4.

Done when: after a turn where an attachment was composed, the persisted user message
equals what was sent (replay byte-identical); provider changes during tool rounds are
delivered on the next composable message; tests pass.
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5 — Close the diagnostics blind spot

Implements D5.

Done when: a rewrite of the previously-last message triggers a `message_prefix` event,
append-only growth triggers none, compaction suppression still works, and tests pass.
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6 — Anthropic cache_control breakpoints

Implements D6.

Done when: Anthropic requests carry ephemeral breakpoints on system and last message,
requests without a system prompt remain valid, and adapter tests pass.
<!-- END_PHASE_6 -->

## Acceptance Criteria

### cache-friendliness.AC1: Stale recall rebuild removed
- **cache-friendliness.AC1.1 Success:** After a recall-enabled turn, the system prompt sent to the model is built exactly once per round (no post-recall rebuild), and recalled fragments still reach the model inside the dynamic-context attachment on the user message.

### cache-friendliness.AC2: Skills no longer mutate the system prompt
- **cache-friendliness.AC2.1 Success:** With skills enabled and relevant skills returned, the system prompt string passed to `model.complete` is byte-identical across two consecutive turns when core memory and diary are unchanged.
- **cache-friendliness.AC2.2 Success:** Relevant skill content appears in the dynamic-context attachment of the latest user message (full snapshot on first composition; delta when the skill set changes; absent when unchanged).
- **cache-friendliness.AC2.3 Failure:** When skill retrieval throws, the turn completes normally with a console warning and no skill section (parity with current behaviour).

### cache-friendliness.AC3: Working memory out of the message prefix
- **cache-friendliness.AC3.1 Success:** `buildMessages` output contains no working-memory message; its content derives solely from conversation history.
- **cache-friendliness.AC3.2 Success:** Working-memory blocks appear in the dynamic-context attachment; after a working-memory write, the next composition includes the updated working-memory content while all previously-sent messages are byte-unchanged. (Snapshot state is anchored per turn — the first round of each turn forces a full snapshot — so the update arrives as part of the next full snapshot, not necessarily a delta.)
- **cache-friendliness.AC3.3 Success:** With no working-memory blocks, no working-memory section appears anywhere in the request.

### cache-friendliness.AC4: Replay is byte-identical
- **cache-friendliness.AC4.1 Success:** When a snapshot attachment is composed onto a user message, the persisted message content is updated to the exact composed string, and the next turn's `buildMessages` reproduces it byte-for-byte.
- **cache-friendliness.AC4.2 Success:** A dynamic-provider change occurring during a tool round (last message not a plain user string) is not consumed; it is delivered as full/delta content on the next composable user message.
- **cache-friendliness.AC4.3 Success:** Composed user messages are single strings (no content-block arrays), persistable in the existing `content` column without schema change.

### cache-friendliness.AC5: Diagnostics detect last-message recomposition
- **cache-friendliness.AC5.1 Success:** If the message that was last in the previous request differs in the current request (e.g. composed vs replayed content), `checkForCacheBust` emits a `message_prefix` event.
- **cache-friendliness.AC5.2 Success:** Append-only growth (previous messages byte-identical, new messages appended) emits no `message_prefix` event.
- **cache-friendliness.AC5.3 Success:** `message_prefix` events remain suppressed when `compactionOccurred` is set.

### cache-friendliness.AC6: Anthropic caching enabled
- **cache-friendliness.AC6.1 Success:** Anthropic requests with a system prompt set `cache_control: {type: "ephemeral"}` on the system parameter's final block and on the final content block of the final message.
- **cache-friendliness.AC6.2 Success:** Requests without a system prompt omit the system breakpoint and remain schema-valid (no empty system param).
- **cache-friendliness.AC6.3 Success:** At most 2 breakpoints are added per request (within Anthropic's limit of 4).
