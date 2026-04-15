# Subconscious — Human Test Plan

## Prerequisites

- PostgreSQL 17 with pgvector running (`docker compose up -d`)
- Constellation daemon built and all unit/integration tests passing: `bun test`
- Config file (`config.toml`) with subconscious section enabled, impulse interval set (e.g. 20 minutes), and a valid model provider configured
- Environment variables set for model provider (e.g. `ANTHROPIC_API_KEY` or `OPENAI_COMPAT_API_KEY`)

## Phase 1: Cold Start — Verify Empty Registry and First Interest Creation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon with a fresh database (no prior subconscious data). Run `SELECT COUNT(*) FROM interests;` against the database. | Returns 0. No interests are seeded by migrations or startup code. |
| 2 | Observe the daemon log output. Wait for the first impulse cycle to fire (based on configured interval, or trigger manually by sending a wake transition event if starting during sleep hours). | Log shows impulse event dispatched to subconscious agent with source `subconscious:impulse`. |
| 3 | After the first impulse cycle completes, run `SELECT id, name, source, status, engagement_score FROM interests ORDER BY created_at;` against the database. | At least one interest exists with `source = 'emergent'` and `status = 'active'`. The agent autonomously chose what to be curious about. |
| 4 | Check the exploration log: `SELECT action, tools_used, outcome FROM exploration_log ORDER BY created_at DESC LIMIT 5;` | At least one entry exists showing the subconscious agent used tools (e.g. web_search, memory_write) to explore its newly created interest. |

## Phase 2: Seeded Interest from Human Conversation

| Step | Action | Expected |
|------|--------|----------|
| 1 | In the REPL, have a conversation about a distinctive topic that does not overlap with any existing interests (e.g., "Tell me about the history of fermentation in winemaking"). Exchange at least 3 messages on the topic. | Agent responds normally. Conversation memories are written to the memory system. |
| 2 | Wait for the next impulse cycle to fire (or advance time if testing with a short interval). | Impulse event fires. The subconscious agent's prompt includes the recent conversation memories about fermentation/winemaking in the `[Recent Memories]` section. |
| 3 | After the impulse cycle completes, run `SELECT name, source, description FROM interests WHERE source = 'seeded' ORDER BY created_at DESC LIMIT 5;` | A new interest related to fermentation or winemaking appears with `source = 'seeded'`. The subconscious agent recognised the human's topic and seeded it as an interest. |
| 4 | If no seeded interest appeared, check `SELECT content FROM messages WHERE conversation_id = '<subconscious-conversation-id>' ORDER BY created_at DESC LIMIT 5;` to inspect the subconscious agent's inner monologue. | Verify the subconscious agent saw the topic. If it chose not to create an interest, that is acceptable emergent behaviour — the mechanism is correct even if the model's judgement differs. Document the reasoning. |

## Phase 3: Cross-Agent Information Flow

| Step | Action | Expected |
|------|--------|----------|
| 1 | Ensure the subconscious has at least one active interest with recent explorations (from Phase 1 or Phase 2). Verify via `SELECT name, engagement_score FROM interests WHERE status = 'active';` and `SELECT action, outcome FROM exploration_log ORDER BY created_at DESC LIMIT 3;`. | Active interests exist with exploration history. |
| 2 | In the REPL, ask a question tangentially related to one of the subconscious's interests (e.g., if it explored "machine learning", ask "What's the difference between supervised and unsupervised learning?"). | The agent's response may reference discoveries from the `[Inner Life]` context section. Look for specific details that could only come from subconscious explorations (not just general knowledge). |
| 3 | If the agent does not reference inner life content, inspect the system prompt by temporarily enabling debug logging. Check that the `[Inner Life]` section is present and contains the expected interests and explorations. | The `[Inner Life]` section should be populated. Whether the agent references it is emergent — the mechanism being present is the verification target. |

## Phase 4: Activity Cycle Transitions

| Step | Action | Expected |
|------|--------|----------|
| 1 | If the daemon is running during configured wake hours, wait for (or manually trigger) a sleep transition. Observe the log output. | A wrap-up reflection impulse fires with source `subconscious:wrap-up`. The subconscious agent's response includes reflections on its day's explorations. |
| 2 | After sleep transition, attempt to trigger an impulse (either wait for cron or manually dispatch). | The impulse is suppressed. Log shows "suppressed during sleep" or equivalent message. No subconscious agent processing occurs. |
| 3 | Trigger (or wait for) a wake transition. Observe the log output. | A morning agenda impulse fires with source `subconscious:morning-agenda`. The subconscious agent reviews its interests and plans exploration for the day. |

## Phase 5: Engagement Decay and Interest Cap

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create enough interests to exceed the configured cap. Either let the agent create them naturally over multiple impulse cycles, or insert test data: `INSERT INTO interests (id, owner, name, description, source, engagement_score, status, last_engaged_at, created_at) VALUES (gen_random_uuid(), '<owner>', 'Test Interest N', 'description', 'emergent', 1.0, 'active', NOW() - INTERVAL '5 days', NOW());` for N interests exceeding `max_active_interests`. | Interests exist in the database above the cap. |
| 2 | Wait for the next impulse cycle's post-impulse housekeeping (decay + cap enforcement). | Log shows decay applied, then cap enforcement. Lowest-scoring interests transition to `dormant`. Run `SELECT name, status, engagement_score FROM interests ORDER BY engagement_score DESC;` to verify. |
| 3 | Verify the active count: `SELECT COUNT(*) FROM interests WHERE owner = '<owner>' AND status = 'active';` | Count equals or is less than `max_active_interests`. |

## End-to-End: Full Curiosity Lifecycle

**Purpose:** Validates the complete path from interest creation through curiosity thread exploration to resolution, across multiple impulse cycles.

1. Start with a clean state (truncate interests, curiosity_threads, exploration_log tables).
2. Wait for the first impulse cycle. Verify the agent creates at least one interest autonomously.
3. Wait for the second impulse cycle. Verify the agent opens at least one curiosity thread under an interest (`SELECT * FROM curiosity_threads WHERE status = 'open';`).
4. Wait for subsequent impulse cycles (2-3 more). Check if any curiosity thread has transitioned to `exploring` and eventually `resolved` with a resolution.
5. Verify exploration log entries accumulate with tools_used and outcomes that reference the curiosity thread's question.
6. Check that engagement scores have been bumped for interests with active exploration (scores higher than 1.0 default).
7. Over time (or by backdating `last_engaged_at`), verify that neglected interests decay and eventually become dormant when the cap is enforced.

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|-----------|-------|
| AC4.7: Human conversation topic appears as seeded interest | The model decides whether to create an interest from conversation memories. The plumbing is tested automatically, but the model's decision is emergent. | See Phase 2. |
| AC4.8: Main agent references subconscious discoveries naturally | The `[Inner Life]` context injection is tested automatically (AC4.5). Whether the model uses it naturally during conversation is emergent behaviour. | See Phase 3. |
| AC5.4 (partial): Agent creates first interests on cold start | The cold-start prompt is tested automatically. Whether the model responds by calling `manage_interest` is emergent. | See Phase 1 steps 2-4. |

## Traceability

| AC | Automated Test | Manual Step |
|----|----------------|-------------|
| AC1.1 | `scheduling.test.ts`, `impulse-assembler.test.ts` | — |
| AC1.2 | `impulse.test.ts` | — |
| AC1.3 | `impulse.test.ts` | — |
| AC1.4 | `scheduling.test.ts` | Phase 4, step 2 |
| AC2.1 | `agent.test.ts` | — |
| AC2.2 | `agent.test.ts` | — |
| AC2.3 | `agent.test.ts` | — |
| AC3.1 | `persistence.test.ts` | — |
| AC3.2 | `persistence.test.ts` | — |
| AC3.3 | `persistence.test.ts` | Phase 5 |
| AC3.4 | `persistence.test.ts`, `emergent.test.ts` | Phase 5 |
| AC3.5 | `persistence.test.ts`, `emergent.test.ts` | — |
| AC4.1 | `subconscious.test.ts` | — |
| AC4.2 | `subconscious.test.ts` | — |
| AC4.3 | `subconscious.test.ts` | — |
| AC4.4 | `subconscious.test.ts` | — |
| AC4.5 | `context.test.ts` | Phase 3, step 3 |
| AC4.6 | `context.test.ts` | — |
| AC4.7 | — | Phase 2 |
| AC4.8 | — | Phase 3 |
| AC5.1 | `impulse.test.ts` | Phase 4, step 3 |
| AC5.2 | `impulse.test.ts` | Phase 4, step 1 |
| AC5.3 | `impulse.test.ts` | End-to-End step 5 |
| AC5.4 | `emergent.test.ts` | Phase 1 steps 2-4 |
| AC5.5 | `emergent.test.ts` | Phase 1, step 1 |
