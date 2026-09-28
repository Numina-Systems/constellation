# Cache-Friendliness — Test Requirements

Slug: `cache-friendliness`
Date: 2026-07-02
Source design: `docs/design-plans/2026-07-02-cache-friendliness.md`
Implementation phases: `phase_01.md` … `phase_06.md`

Maps every acceptance criterion (`cache-friendliness.AC1.1` … `cache-friendliness.AC6.3`) to
either an automated test or documented human verification. No criterion is left unmapped.

## Conventions

- Runner: `bun:test`, plain `expect()`.
- Fakes are hand-rolled factories (`createMock*`); no mocking libraries.
- Test names are prefixed with the AC identifier; all-mock tests carry a `(unit)` marker.
- Integration tests are gated on env (`ANTHROPIC_API_KEY`, Postgres, Ollama) and skip otherwise.
- Model requests are captured via `createMockModelProvider(responses, tracker)`; `tracker.requests`
  holds every `ModelRequest` (fields `system` and `messages`), which is how prefix-stability and
  attachment-delivery assertions are made.

## Design decisions the tests must respect

These planning decisions shape what the automated tests can and cannot assert:

- **Single-string composition (D3).** `buildUserMessage` returns `{role:'user', content: string}`,
  not a content-block array. Attachment-delivery tests assert on substrings of a string, and replay
  tests assert byte-identity of a persisted TEXT column — no schema/content-block shape checks.
- **Per-turn snapshot anchoring (D4).** The first round of every turn forces a full snapshot
  (`forceFullSnapshot = isFirstRound`). Cross-turn tests therefore assert the updated content arrives
  as part of the *next full snapshot*, not necessarily as a delta (AC2.2, AC3.2 call this out).
- **Holder-based providers (D1/D2).** Skills and working memory are `SkillsContextState` /
  `WorkingMemoryContextState` holders registered as `classification:'dynamic'` providers. Provider
  contract is unit-testable in isolation (Functional Core) before agent-level wiring is tested.
- **Consume-only-when-deliverable (D4).** `computeSnapshot` (which advances `previousHashes`) runs at
  most once per turn and only when the last message is a plain user string. The tool-round test
  (AC4.2) asserts provider-call counts, not just content.
- **Unconditional wiring.** The skills provider and dep are registered even when `skillRegistry` is
  `undefined` (the holder returns `undefined` until set; the loop guards retrieval). No test should
  gate wiring on registry presence.

---

## Automated test coverage

| Criterion | Test type | Test file | What the test must verify |
|---|---|---|---|
| **AC1.1** | unit | `src/agent/agent.test.ts` | On a recall-enabled turn (single round), `buildSystemPrompt` is invoked exactly once (counting wrapper on the memory manager) — the post-recall rebuild is gone — while recall still reaches the model via the dynamic-context attachment. |
| **AC2.1** | unit | `src/agent/agent.test.ts` | Two consecutive `processMessage` calls with a non-empty fake skill list both times: `tracker.requests[0].system === tracker.requests[1].system` (byte-identical) and neither `system` contains the skill section text. |
| **AC2.2** | unit | `src/agent/agent.test.ts` | The last message of `tracker.requests[0].messages` is the user message and its content contains the `[Dynamic Context — Full Snapshot]` header, the `## skills` section heading, and the skill text (delivery via attachment, full snapshot on first composition). |
| **AC2.2** (provider contract) | unit | `src/skill/context.test.ts` | `createSkillsContextProvider()` returns `undefined` before any `setSection`; returns the exact string after `setSection(s)`; returns `undefined` again after `setSection(undefined)`. |
| **AC2.3** | unit | `src/agent/agent.test.ts` | With a fake registry whose `getRelevant` throws, `processMessage` resolves to the model's text (turn completes), a `console.warn` fires, and no skill content appears anywhere in `tracker.requests[0]` (system or messages). |
| **AC3.1** | unit | `src/agent/context.test.ts` | `buildMessages(history)` output contains no `[Working Memory Context]` message and no prepended index-0 working-memory message; length/content derive solely from `history`. |
| **AC3.1** (agent-level) | unit | `src/agent/agent.test.ts` | With `getWorkingBlocks` returning one block, `tracker.requests[0].messages[0]` is the first history message and no message contains `[Working Memory Context]`. |
| **AC3.2** (formatter contract) | unit | `src/memory/context.test.ts` | `formatWorkingMemorySection([a,b])` produces `### label1\ncontent1\n\n### label2\ncontent2`; the provider returns the section after `setBlocks([block])`. |
| **AC3.2** (agent-level) | unit | `src/agent/agent.test.ts` | Turn 1 with block A, then mutate to A′, then turn 2: turn 2's last-message attachment carries A′ under `## working-memory`, and every message shared with turn 1's request is byte-identical (`JSON.stringify` equality over the shared prefix, excluding turn 1's composed final message). |
| **AC3.3** (empty → undefined) | unit | `src/memory/context.test.ts` | `formatWorkingMemorySection([])` returns `undefined`; provider returns `undefined` before `setBlocks` and after `setBlocks([])`. |
| **AC3.3** (agent-level) | unit | `src/agent/agent.test.ts` | With `getWorkingBlocks` returning `[]`, the string `working-memory` appears nowhere in `JSON.stringify(tracker.requests[0])`. |
| **AC4.1** | unit | `src/agent/agent.test.ts` | After a turn where an attachment was composed: the mock persistence's stored user-message content equals the exact sent string, and turn 2's replay reproduces the message at turn 1's last index byte-identically (`JSON.stringify` equality). |
| **AC4.2** | unit | `src/agent/agent.test.ts` | Two-round turn with a controllable dynamic provider mutated during the tool round: `providerCalls === 1` after the turn (snapshot not consumed on the tool round), and a subsequent turn's composed attachment carries the updated value. |
| **AC4.3** | unit | `src/agent/messages.test.ts` | `buildUserMessage(text, snapshot)` for full and delta modes returns `{role:'user', content}` with `typeof content === 'string'` (no content-block arrays), header + content + text concatenated in order. |
| **AC5.1** | unit | `src/agent/cache-diagnostics.test.ts` | Call 1 `[m1,m2]`, call 2 `[m1,m2′,m3]` (m2 rewritten, m3 appended), all flags false: exactly one event with `dimension === 'message_prefix'`. |
| **AC5.2** | unit | `src/agent/cache-diagnostics.test.ts` | Call 1 `[m1,m2]`, call 2 `[m1,m2,m3]` (m2 byte-identical, append-only): no `message_prefix` event. |
| **AC5.3** | unit | `src/agent/cache-diagnostics.test.ts` | Same rewrite sequence as AC5.1 but call 2 passes `flags:{compactionOccurred:true}`: no `message_prefix` event (suppression holds under full-list hashing). |
| **AC6.1** | unit | `src/model/anthropic.test.ts` | `buildAnthropicSystemParam` with system content returns a block array whose final block has `cache_control:{type:'ephemeral'}` and whose `text` equals the prior string concatenation; `applyCacheControlToLastBlock` marks only the final content block of the final message (string content → `[{type:'text',text,cache_control}]`; array content → `cache_control` on last block only, incl. `tool_result`). No API key. |
| **AC6.2** | unit | `src/model/anthropic.test.ts` | No system content → `buildAnthropicSystemParam` returns `undefined` (not `''`, not `[]`); a request built without a system prompt omits the `system` key and stays schema-valid. |
| **AC6.3** | unit | `src/model/anthropic.test.ts` | `cache_control` occurrence count in `JSON.stringify` of a fully-built request param: exactly 2 with a system prompt, exactly 1 without; non-final messages carry none (≤ Anthropic's limit of 4). |

### Notes on selected mappings

- **AC2.2, AC3.2, AC3.3** are each split into a provider/formatter Functional-Core unit test (the holder
  contract) and an agent-level integration-of-fakes unit test (delivery through the snapshot pipeline).
  Both are `(unit)` (all-mock); listing them separately keeps the holder contract independently
  regression-guarded, per the D1/D2 holder-based design.
- **AC4.2** deliberately asserts the *provider-call count*, not only content, because the whole point of
  D4 is that `computeSnapshot` (which advances `previousHashes`) is not invoked on tool rounds. A
  content-only assertion would pass even if the hash were wrongly consumed and re-emitted.
- **AC5.x** ride on the Functional-Core purity of `cache-diagnostics.ts` — no mocks. Phase 5's own
  gate (agent turns must not emit new `cache bust detected` warnings post-Phase-4) is exercised
  implicitly by the existing `src/agent/agent.test.ts` suite running green under full-list hashing;
  that regression guard is automated (suite-level), not a separate named test.
- **AC6.x** are all pure-helper tests with no SDK client and no API key, per Phase 6's directive that
  request-shape assertions live in Functional-Core tests against exported helpers.

---

## Human verification

Every acceptance criterion above is automatable and mapped. The automated tests verify *structure*:
prefix byte-stability, attachment delivery, single-string persistence, diagnostic events, and the
presence/shape of `cache_control` breakpoints. What they cannot verify is the *real-world payoff* —
that byte-stable prefixes and Anthropic breakpoints actually produce provider cache hits and KV-cache
reuse against live endpoints. That is an observation task, not an assertion task, so it is documented
here rather than forced into a flaky env-gated test.

### HV1 — Live provider cache-hit behaviour (payoff verification)

**Why not automated:** Cache hits are a property of the *provider's* infrastructure, observable only
via response metadata (Anthropic `usage.cache_read_input_tokens` / `cache_creation_input_tokens`) or
inferred latency/throughput (Ollama KV-cache reuse). There is no in-process signal a unit test can
assert on; a mock model has no cache. Byte-stability (the thing we control) is fully automated above —
this step confirms the byte-stability translates into the intended provider behaviour end-to-end.

**Scope:** Payoff confirmation for AC2 (skills), AC3 (working memory), AC4 (replay), and AC6
(Anthropic breakpoints) taken together — these are the criteria whose value only materializes across a
multi-turn live session.

**Verification approach:**

1. **Anthropic (direct or via OpenRouter), key present.** Run the daemon against an Anthropic model.
   Conduct a multi-turn session (≥ 3 turns) that stays above the model's minimum cacheable prefix
   (≈ 4096 tokens on Opus-tier — seed core memory / conversation so the prefix clears the floor).
   Confirm on turn ≥ 2 that the response `usage` reports non-zero `cache_read_input_tokens`, and that
   turn 1 reports `cache_creation_input_tokens`. A working-memory or skill change mid-session should
   still show cache reads for the stable prefix (the change rides the tail attachment, not the prefix).

2. **Ollama (native `/api/chat`), local endpoint at `192.168.1.6:11434`.** Run a multi-turn session
   and observe that repeated turns reuse the KV cache — practically, steady or improving
   prompt-eval throughput across turns rather than a full re-eval each turn (Ollama does not expose an
   explicit cache-hit field; latency/prompt-eval-count is the proxy). Confirm a working-memory write
   does not cause a full prefix re-eval on the following turn.

3. **Cache-bust diagnostics, any provider (AC5 payoff).** Across the same multi-turn live session,
   confirm the daemon logs **no** `cache bust detected` / `message_prefix` warnings during normal
   append-only growth and normal working-memory/skill updates. A warning here indicates a real replay
   mismatch that the automated suite's fakes did not surface — investigate the differing message
   (`JSON.stringify` diff of consecutive requests) rather than suppressing the detector. This makes the
   full-list diagnostic (AC5) double as a live tripwire for the prefix-stability phases (AC1–AC4).

**Pass condition:** Anthropic session shows `cache_read_input_tokens > 0` on turns ≥ 2; Ollama session
shows no full prefix re-eval on stable-prefix turns; zero spurious `message_prefix` warnings across the
session under append-only and dynamic-content-update conditions.

---

## Coverage summary

- **17 of 17 acceptance criteria** are covered by automated tests (all `bun:test`, all `(unit)` /
  all-mock, no live env required). Several criteria (AC2.2, AC3.2, AC3.3) carry two automated tests
  each — a Functional-Core provider/formatter contract test plus an agent-level delivery test.
- **0 criteria are automation-orphans** — every AC maps to at least one automated test.
- **1 human-verification item (HV1)** covers the real-world payoff that automation structurally cannot
  reach: live provider cache-hit / KV-reuse behaviour and the absence of `cache bust detected` warnings
  across a multi-turn session. It is a payoff confirmation spanning AC2/AC3/AC4/AC5/AC6, not a substitute
  for any AC's automated coverage.
