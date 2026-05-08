# Reflexive Recall — Test Requirements

## Automated Tests

### reflexive-recall.AC1: Decomposition

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC1.1 | unit | `src/recall/decompose.test.ts` | Valid JSON with queries=["CalDAV project"] and entities=["CalDAV"] parses correctly from model response |
| AC1.2 | unit | `src/recall/decompose.test.ts` | Multi-topic message produces 2-4 distinct queries covering each topic in parsed output |
| AC1.3 | unit | `src/recall/decompose.test.ts` | Single-word input through `decomposeMessage()` (mocked model) returns one query containing that word |
| AC1.4 | unit | `src/recall/decompose.test.ts` | Message with no proper nouns produces empty entities array in parsed output |

### reflexive-recall.AC2: Retrieval

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC2.1 | unit | `src/recall/retrieve.test.ts` | Each semantic query calls `SearchStore.search()` with `mode: 'hybrid'` and `limit: 5` |
| AC2.2 | unit | `src/recall/retrieve.test.ts` | Each named entity calls `SearchStore.search()` with `mode: 'keyword'` and `limit: 3` |
| AC2.3 | unit | `src/recall/retrieve.test.ts` | Overlapping results from multiple queries are deduplicated (highest score wins) and merged into a single ranked list |

### reflexive-recall.AC3: Domain and Tier Filtering

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC3.1 | unit | `src/recall/retrieve.test.ts` | Memory domain results with tiers `core`, `working`, and `archival` all appear in output fragments |
| AC3.2 | unit | `src/recall/retrieve.test.ts` | Conversation domain results appear in output fragments |
| AC3.3 | unit | `src/recall/retrieve.test.ts` | Results with labels matching `coreLabels` param are filtered out of output |

### reflexive-recall.AC4: Token Budget

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC4.1 | unit | `src/recall/retrieve.test.ts` | With tokenBudget=100 and fragments totalling 200+ tokens, output `totalTokens` stays within budget |
| AC4.2 | unit | `src/recall/retrieve.test.ts` | Single fragment exceeding remaining budget is truncated (shorter content) rather than dropped |
| AC4.3 | unit | `src/recall/context.test.ts` | Empty fragments array causes context provider to return `undefined` (no section injected) |

### reflexive-recall.AC5: Fallback Cascade

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC5.1 | unit | `src/recall/orchestrator.test.ts` | When `model.complete()` throws, orchestrator calls search with raw message as query (fallback path) |
| AC5.2 | unit | `src/recall/decompose.test.ts` | Malformed JSON (plain text, truncated, missing fields) from model causes `parseDecompositionResponse()` to return empty result; orchestrator falls back to raw query |
| AC5.3 | unit | `src/recall/orchestrator.test.ts` | Orchestrator calls `searchStore.search()` with `mode: 'hybrid'` regardless of embedding state (trusts SearchStore internal degradation) |
| AC5.4 | unit | `src/recall/orchestrator.test.ts` | With `model: null` (no decomposition), search is still called with raw message — SearchStore handles embedding failure internally |

### reflexive-recall.AC6: Guard Conditions

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC6.1 | unit | `src/recall/orchestrator.test.ts` | `recall_enabled=false` prevents `performRecall()` from being called (checked in agent loop); verified via composition root wiring that `recallContextState` is `undefined` when disabled |
| AC6.2 | unit | `src/recall/orchestrator.test.ts` | Message "hi" (3 chars, < 10) causes `performRecall()` to return `null` without calling searchStore |
| AC6.3 | unit | `src/recall/orchestrator.test.ts` | `embedding: null` causes `performRecall()` to return `null` without calling searchStore or model |
| AC6.4 | unit | `src/recall/orchestrator.test.ts` | `model: null, modelName: null` skips decomposition but still calls search with raw message as query |

### reflexive-recall.AC7: Prompt Injection

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC7.1 | unit | `src/recall/context.test.ts` | Context provider with set result returns string containing `## Recalled Context` header |
| AC7.2 | unit | `src/recall/context.test.ts` | Fragment rendering includes `### [label | domain]` header and content text; output does NOT contain score values |
| AC7.3 | unit | `src/recall/context.test.ts` | Context provider with no result set (or set to `null`) returns `undefined` |

### reflexive-recall.AC8: Trace Recording

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC8.1 | unit | `src/recall/orchestrator.test.ts` | `traceRecorder.record()` is called with `toolName: 'recall'`, `durationMs` > 0, and `outputSummary` containing fragment count |
| AC8.2 | unit | `src/recall/orchestrator.test.ts` | When search returns empty results (recall returns null), `traceRecorder.record()` is still called with `success: true` and fragment count 0 |

### reflexive-recall.AC9: Compaction Ordering

| AC | Test Type | Test File | Verifies |
|----|-----------|-----------|----------|
| AC9.1 | integration | `src/agent/agent.ts` (code review) | Recall step is positioned inside the tool loop AFTER compaction check (which runs before the tool loop) |
| AC9.2 | integration | `src/agent/agent.ts` (code review) | Recalled context is injected into system prompt via ContextProvider, NOT into conversation history — compaction threshold estimates conversation history only |

## Human Verification

### reflexive-recall.AC7.1 (ordering aspect): Context provider position in prompt

- **Justification:** The ordering guarantee ("after core memory and before skills") depends on the position of the recall context provider in the `contextProviders` array in `src/index.ts`. This is a wiring concern verified at composition-root level. While the presence of the section is unit-tested, the relative ordering with respect to other context providers is a composition concern best verified by code inspection.
- **Human verification approach:** Inspect `src/index.ts` composition root and confirm `recallContextProvider` appears in the `contextProviders` array. Run the daemon with `recall_enabled=true` and a populated memory store, inspect the system prompt sent to the model (via trace or debug logging) to confirm section ordering: core memory → recalled context → skills.

### reflexive-recall.AC9.1 / AC9.2 (architectural ordering)

- **Justification:** These criteria verify temporal ordering within the agent loop. While the code structure can be inspected statically, there is no straightforward unit test that asserts "X runs before Y" without coupling to implementation details.
- **Human verification approach:** Read `src/agent/agent.ts` and confirm: (1) compaction check occurs before the `while` tool loop; (2) recall step is inside the tool loop after `buildSystemPrompt()`; (3) recalled context is set on the context provider (not appended to conversation messages). Optionally, add a temporary `console.log` to both compaction and recall entry points and observe execution order in a live turn.
