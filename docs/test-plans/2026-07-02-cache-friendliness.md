<title>Cache-Friendliness — Human Test Plan</title>

# Cache-Friendliness — Human Test Plan

Feature: `cache-friendliness` (branch `feat/cache-friendliness`) · BASE `7d62094` → HEAD `12d1433`

Automated coverage validation: **PASS** (17/17 acceptance criteria, 195 tests green, all-mock). This plan covers the one thing automation structurally cannot reach: the real-world payoff — that byte-stable prefixes plus Anthropic `cache_control` breakpoints actually produce **provider cache hits** and **KV-cache reuse** against live endpoints (HV1 in the test requirements).

The automated suite verifies *structure* (prefix byte-stability, attachment delivery, single-string persistence, diagnostic events, breakpoint shape). This plan verifies *payoff* end-to-end. A failure here is a real replay/prefix mismatch the fakes didn't surface — investigate the differing message, don't suppress.

---

## Prerequisites

- Working tree on `feat/cache-friendliness` at HEAD `12d1433`.
- `bun run build` clean (type-check passes).
- `bun test` green. **Note:** the automated cache-friendliness suite is entirely mock-based and needs no database. The broader suite has Postgres-gated integration tests — those were **not** exercised in this analysis session because Docker/Postgres was unavailable (they fail with `ECONNREFUSED`, which is environmental, not a code defect). Before running this plan, bring up the real stack so those pass too:
  - `docker compose up -d` (pgvector Postgres)
  - `bun run migrate`
  - `DATABASE_URL` set; `bun test` fully green including integration.
- At least one working model provider configured in `config.toml`:
  - **Anthropic path:** `ANTHROPIC_API_KEY` set (direct) or `OPENROUTER_API_KEY` set with an Anthropic model routed via OpenRouter.
  - **Ollama path:** endpoint reachable at `192.168.1.6:11434` (per project memory) with a chat-capable model pulled.
- `cache_diagnostics` config left at its default (**true**) so the cache-bust tripwire is active during the session.

---

## Phase 1: Anthropic provider cache-hit payoff (AC2 / AC3 / AC4 / AC6 together)

Purpose: confirm byte-stable prefixes + the two ephemeral `cache_control` breakpoints translate into non-zero provider cache reads on turn ≥ 2. Cache hits are only observable in Anthropic response `usage` metadata (`cache_read_input_tokens` / `cache_creation_input_tokens`) — there is no in-process signal.

Key gotcha: Anthropic only caches prefixes above a model-dependent floor (~4096 tokens on Opus tier). If your prefix is short, you will see zero cache activity and that is *expected*, not a bug. Seed enough context to clear the floor before judging.

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Configure an Anthropic model (direct or OpenRouter). Start the daemon: `bun run start`. | REPL comes up, agent initializes against the Anthropic provider. |
| 1.2 | Seed the prefix over the cache floor: ensure core memory / conversation history is large enough that the system prompt + tool defs + history clear ~4096 tokens. Load some core memory blocks or paste a long first message if needed. | Prefix is large enough to be cacheable. |
| 1.3 | Turn 1: send any substantive message. Capture the response `usage`. | `usage.cache_creation_input_tokens` > 0 (cache is being written). `cache_read_input_tokens` may be 0 on the first turn. |
| 1.4 | Turn 2: send a follow-up message (append-only growth, no memory edits). Capture `usage`. | `usage.cache_read_input_tokens` > 0 — the stable prefix (system param + prior messages) was read from cache. |
| 1.5 | Turn 3: send another follow-up. Capture `usage`. | `cache_read_input_tokens` > 0 again; read count grows with the stable prefix. |
| 1.6 | Mid-session working-memory change: trigger a working-memory write (e.g. ask the agent to update a working block, or drive `memory_write` to a `working`-tier block), then send another message. Capture `usage`. | `cache_read_input_tokens` still > 0. The change rides the **tail attachment** on the new user message (`## working-memory` under `[Dynamic Context — Full Snapshot]`), NOT the cached prefix — so the prefix cache is preserved. This is the whole point of AC3. |
| 1.7 | Mid-session skill change: send a message that pulls in a *different* relevant skill than earlier turns, then continue. Capture `usage`. | `cache_read_input_tokens` still > 0. The new skill content appears in the tail attachment (`## skills` / `## Active Skills`), not injected into the cached system prompt (AC2.1 keeps the system prompt byte-stable). |

**Where to observe `usage`:** Anthropic returns `usage.cache_read_input_tokens` and `usage.cache_creation_input_tokens` on each response. The model layer surfaces these (`ModelResponse.cache_read_input_tokens` / `cache_creation_input_tokens` per `src/model/CLAUDE.md`). If the REPL doesn't print them, enable debug logging or temporarily log the response usage.

**Pass condition:** turns ≥ 2 show `cache_read_input_tokens > 0`; the working-memory and skill changes in 1.6–1.7 do NOT drop cache reads to zero.

---

## Phase 2: Ollama KV-cache reuse payoff (AC2 / AC3 / AC4)

Purpose: confirm repeated turns reuse the Ollama KV cache. Ollama exposes no explicit cache-hit field — prompt-eval throughput / prompt-eval-count is the proxy. A full prefix re-eval every turn shows up as prompt-eval time scaling with total prefix length instead of staying flat.

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | Point config at the Ollama endpoint (`192.168.1.6:11434`) with a chat model. `bun run start`. | Daemon runs against Ollama via the native `/api/chat` endpoint. |
| 2.2 | Turn 1: send a substantive message. Note prompt-eval count / duration if surfaced (Ollama returns `prompt_eval_count` / `prompt_eval_duration`). | Baseline prompt-eval recorded — this turn evaluates the full prefix. |
| 2.3 | Turns 2–3: send follow-ups (append-only). Compare prompt-eval on the *stable prefix portion* across turns. | Steady or improving prompt-eval throughput — the stable prefix is reused, not fully re-evaluated each turn. No full re-eval. |
| 2.4 | Trigger a working-memory write, then send another message. | The following turn does NOT force a full prefix re-eval. The working-memory delta rides the tail attachment; the prefix stays KV-cached. |

**Pass condition:** no full prefix re-eval on stable-prefix turns; a working-memory write does not cause a full re-eval on the next turn.

---

## Phase 3: Cache-bust diagnostic tripwire (AC5 payoff, any provider)

Purpose: with `cache_diagnostics` enabled, a byte-stable append-only session must produce **zero** `cache bust detected` / `message_prefix` warnings. The full-message-list detector (AC5) doubles as a live tripwire for the prefix-stability phases (AC1–AC4). A warning here means a real replay mismatch the mock fakes didn't reproduce.

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Reuse the Phase 1 or Phase 2 session (diagnostics default = true). Watch daemon logs across all turns. | No `cache bust detected` and no `message_prefix` warnings during normal append-only growth. |
| 3.2 | During the same session, perform the working-memory write and skill change from steps 1.6/1.7 (or 2.4). Watch logs. | Still no spurious `message_prefix` warning — dynamic-content updates ride the tail attachment and don't rewrite the prefix. Expected suppressions (compaction, first turn, tool mutation) don't emit either. |
| 3.3 | If any `message_prefix` warning fires: capture the two consecutive `ModelRequest`s and diff them (`JSON.stringify` diff of the message lists). Identify the message that changed. | The diff pinpoints a prefix message that was deleted/rewritten/reordered — a real prefix-stability regression. **Investigate the differing message; do not suppress the detector.** |

**Pass condition:** zero spurious `message_prefix` warnings across the session under both append-only and dynamic-content-update (working-memory + skill) conditions.

---

## End-to-End: Multi-turn stable-prefix session with mid-session dynamic updates

Purpose: single scenario that exercises the whole feature the way it matters — a real conversation where memory and skills change mid-flight but the cacheable prefix stays byte-stable, so the provider keeps hitting cache.

Steps:
1. Start the daemon against Anthropic (Phase 1 config), prefix seeded above the cache floor.
2. Run a ≥ 4-turn conversation. Turn 1 writes cache (`cache_creation_input_tokens > 0`); turns 2+ read cache (`cache_read_input_tokens > 0`).
3. On turn 3, trigger a working-memory update; on turn 4, cause a new skill to become relevant.
4. Confirm across turns 2–4: `cache_read_input_tokens` stays > 0, the daemon logs no `message_prefix` warnings, and the updated working-memory/skill content appears in the *last user message's* dynamic-context attachment (not in the system prompt).

Result: validates AC2 (skills via attachment, stable system prompt), AC3 (working memory via attachment), AC4 (byte-identical persisted replay across turns), AC5 (no spurious cache-bust), and AC6 (breakpoints producing real reads) as one coherent payoff — the thing the mock suite can only approximate.

---

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| **HV1** — Live provider cache-hit / KV-reuse behaviour (payoff for AC2/AC3/AC4/AC5/AC6) | Cache hits are a property of the provider's infrastructure, observable only via response metadata (Anthropic `usage.cache_read_input_tokens`) or inferred throughput (Ollama). A mock model has no cache — there is no in-process signal to assert. Byte-stability (the part we control) is fully automated; this confirms it translates into provider behaviour. | Anthropic: Phase 1. Ollama: Phase 2. Diagnostic tripwire: Phase 3. Combined: End-to-End scenario. Pass = Anthropic `cache_read_input_tokens > 0` on turns ≥ 2, Ollama no full prefix re-eval on stable-prefix turns, zero spurious `message_prefix` warnings across the session under append-only and dynamic-update conditions. |

---

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 (single system-prompt build per round) | `agent.test.ts:2325` | Implicit in E2E (no extra prefix rebuild = stable prefix, observable via cache reads) |
| AC2.1 (system prompt byte-stable across turns) | `agent.test.ts:2395` | Phase 1 step 1.7; E2E step 4 |
| AC2.2 (skills via dynamic attachment) | `agent.test.ts:2494`, `skill/context.test.ts:242` | Phase 1 step 1.7; E2E step 3–4 |
| AC2.3 (skill retrieval failure non-fatal) | `agent.test.ts:2603` | Not re-verified manually (fully deterministic; covered by automation) |
| AC3.1 (no working-memory prepend) | `context.test.ts:38`, `agent.test.ts:2697` | Phase 1 step 1.6; E2E step 3–4 |
| AC3.2 (working-memory update via tail attachment, stable prefix) | `memory/context.test.ts:33,80`, `agent.test.ts:2791` | Phase 1 step 1.6; Phase 2 step 2.4; E2E step 3–4 |
| AC3.3 (no working-memory blocks → no section) | `memory/context.test.ts:8,67`, `agent.test.ts:2959` | Not re-verified manually (deterministic) |
| AC4.1 (composed message persisted byte-identically) | `agent.test.ts:3116` | E2E step 4 (byte-identical replay = sustained cache reads) |
| AC4.2 (provider change on tool round not consumed) | `agent.test.ts:3192` | Implicit in Phase 3 (no spurious bust during tool rounds) |
| AC4.3 (single-string composition) | `messages.test.ts:60` | Not re-verified manually (deterministic) |
| AC5.1 (prefix rewrite detected) | `cache-diagnostics.test.ts:1251` | Phase 3 step 3.3 (diff-on-warning path) |
| AC5.2 (append-only → no event) | `cache-diagnostics.test.ts:1283` | Phase 3 steps 3.1–3.2 |
| AC5.3 (compaction suppresses) | `cache-diagnostics.test.ts:1314` | Phase 3 (compaction turns produce no spurious warning) |
| AC6.1 (cache_control on final block) | `anthropic.test.ts:432,481,535` | Phase 1 steps 1.3–1.5 (breakpoints produce real cache writes/reads) |
| AC6.2 (undefined when no system) | `anthropic.test.ts:508,521` | Not re-verified manually (deterministic) |
| AC6.3 (exactly 2 / 1 breakpoints) | `anthropic.test.ts:596,627,657` | Phase 1 (2 breakpoints → system + tail both cache) |
