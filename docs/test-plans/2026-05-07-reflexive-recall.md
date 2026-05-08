# Reflexive Recall — Human Test Plan

## Prerequisites
- PostgreSQL with pgvector running (`docker compose up -d`)
- Database migrated (`bun run migrate`)
- Populated memory store (at least a few core, working, and archival memories)
- At least one prior conversation in the database
- `config.toml` with `recall_enabled = true` and a valid `recall_token_budget` (e.g., 2048)
- A model configured for both the main agent and for decomposition
- Embedding provider configured and functional
- `bun test src/recall/` passing (68 tests, 0 failures)

## Phase 1: Guard Conditions

| Step | Action | Expected |
|------|--------|----------|
| 1.1 | Set `recall_enabled = false` in `config.toml`. Start the daemon with `bun run start`. Send a multi-sentence message referencing known memory content. | No `[Recalled Context]` section appears in the system prompt. Verify via trace logs or debug output that `performRecall` was never called. |
| 1.2 | Set `recall_enabled = true`. Send a very short message like "hi" (3 chars). | No recalled context section appears. Trace log (if present) should show recall skipped due to message length. |
| 1.3 | Remove or invalidate the embedding provider config. Send a normal-length message. | No recalled context section. Agent should still function normally for the conversation turn. |

## Phase 2: Decomposition and Retrieval

| Step | Action | Expected |
|------|--------|----------|
| 2.1 | With recall enabled and embeddings working, send: "What did we discuss about the CalDAV project last week?" | System prompt should contain `## Recalled Context` with fragments referencing CalDAV-related memories or conversations. Check trace log for decomposition output showing queries like "CalDAV project" and entities like "CalDAV". |
| 2.2 | Send a multi-topic message: "Tell me about the scheduling system and also what we said about Bluesky integration." | Recalled context should contain fragments from both topics. Trace should show 2+ distinct queries in decomposition. |
| 2.3 | Send a message about a topic with no matching content in memory: "What do we know about quantum computing?" | Recall should either return no fragments (no recalled context section) or return low-relevance results. Agent should handle this gracefully. |

## Phase 3: Token Budget Enforcement

| Step | Action | Expected |
|------|--------|----------|
| 3.1 | Set `recall_token_budget = 100` (very small). Send a message that would normally retrieve many results. | Recalled context section should be brief. Fragment count should be limited. Total tokens in trace should be <= 100. |
| 3.2 | Set `recall_token_budget = 4096` (generous). Send the same message. | More fragments should appear. Compare with step 3.1 to confirm budget is being respected. |

## Phase 4: Fallback Cascade

| Step | Action | Expected |
|------|--------|----------|
| 4.1 | Temporarily misconfigure the decomposition model (invalid API key or unreachable endpoint). Send a normal message. | Recall should still work, falling back to raw message as the search query. Trace should still be recorded. No error should surface to the user. |
| 4.2 | Restore the model. Remove the model config entirely (`model = null` equivalent). Send a message. | Recall should use raw message for search (skip decomposition). Results should still appear if relevant content exists. |

## Phase 5: Context Injection Ordering

| Step | Action | Expected |
|------|--------|----------|
| 5.1 | Enable debug logging or add a temporary `console.log` at the entry of compaction check and recall. Send a message that triggers both. | Compaction check runs before the tool loop. Recall runs inside the tool loop. Temporal ordering: compaction first, recall second. |
| 5.2 | Inspect the full system prompt sent to the model (via trace, debug log, or temporary logging in `buildSystemPrompt`). | Verify section ordering: core memory appears first, then `## Recalled Context`, then skills section. Recalled context is NOT in conversation history messages. |

## End-to-End: Full Recall Pipeline

1. Ensure memory store has at least 3 core memories (e.g., personality, goals, preferences), 2 working memories, and 1 archival memory. Ensure at least 2 past conversations exist with searchable content.
2. Set `recall_enabled = true`, `recall_token_budget = 2048`.
3. Start the daemon. Send: "What are my core beliefs and what did we talk about regarding the project roadmap?"
4. Verify the system prompt contains `## Recalled Context` with fragments from both memory and conversation domains.
5. Verify fragment headers use `### [label | domain]` format (no scores visible).
6. Verify core memory labels already present in the system prompt's core memory section are NOT duplicated in recalled context (coreLabels filtering).
7. Check the operation trace for a `recall` entry with `success: true`, `durationMs > 0`, and fragment count in the summary.
8. Send a follow-up message in the same conversation turn that triggers tool use. Verify that recall does NOT re-run for subsequent tool rounds (once-per-turn caching).

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC7.1 (ordering) | Context provider position in `contextProviders` array is a composition-root wiring concern | Inspect `src/index.ts`. Find the `contextProviders` array. Confirm `recallContextProvider` appears after core memory provider and before skills provider. Run daemon with populated store and inspect actual system prompt to verify section ordering. |
| AC9.1 | Temporal ordering within agent loop cannot be unit-tested without coupling to implementation | Read `src/agent/agent.ts`. Confirm compaction check occurs before the `while` tool loop. Confirm recall (`performRecall`) is called inside the tool loop. Optionally add `console.log` to both entry points and observe ordering in a live turn. |
| AC9.2 | Architectural constraint: recalled context goes into system prompt, not conversation history | Read `src/agent/agent.ts`. Confirm recalled context is set via `contextProvider.setResult()` (which feeds into `buildSystemPrompt`), NOT appended to the conversation messages array. This ensures compaction threshold estimates only count conversation history tokens. |
| AC6.1 (config wiring) | Config flag disabling recall is a composition-root concern | Inspect `src/index.ts`. Confirm that when `recall_enabled` is false, the `recallContextState` is set to `undefined`, preventing `performRecall` from being wired into the agent loop. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `decompose.test.ts` | — |
| AC1.2 | `decompose.test.ts` | — |
| AC1.3 | `decompose.test.ts` | — |
| AC1.4 | `decompose.test.ts` | — |
| AC2.1 | `retrieve.test.ts` | — |
| AC2.2 | `retrieve.test.ts` | — |
| AC2.3 | `retrieve.test.ts` | — |
| AC3.1 | `retrieve.test.ts` | — |
| AC3.2 | `retrieve.test.ts` | — |
| AC3.3 | `retrieve.test.ts` | — |
| AC4.1 | `retrieve.test.ts` | Phase 3, Steps 3.1-3.2 |
| AC4.2 | `retrieve.test.ts` | — |
| AC4.3 | `context.test.ts` | — |
| AC5.1 | `orchestrator.test.ts` | Phase 4, Step 4.1 |
| AC5.2 | `decompose.test.ts` + `orchestrator.test.ts` | — |
| AC5.3 | `orchestrator.test.ts` | — |
| AC5.4 | `orchestrator.test.ts` | Phase 4, Step 4.2 |
| AC6.1 | `orchestrator.test.ts` (guards) | Phase 1, Step 1.1 + Human Verification |
| AC6.2 | `orchestrator.test.ts` | Phase 1, Step 1.2 |
| AC6.3 | `orchestrator.test.ts` | Phase 1, Step 1.3 |
| AC6.4 | `orchestrator.test.ts` | Phase 4, Step 4.2 |
| AC7.1 | `context.test.ts` | Phase 5, Step 5.2 + Human Verification |
| AC7.2 | `context.test.ts` | End-to-End, Step 5 |
| AC7.3 | `context.test.ts` | — |
| AC8.1 | `orchestrator.test.ts` | End-to-End, Step 7 |
| AC8.2 | `orchestrator.test.ts` | — |
| AC9.1 | Code review | Phase 5, Step 5.1 + Human Verification |
| AC9.2 | Code review | Phase 5, Step 5.2 + Human Verification |
