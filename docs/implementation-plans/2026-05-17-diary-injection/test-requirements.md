# Test Requirements: diary-injection

**Design:** `docs/design-plans/2026-05-17-diary-injection.md`
**Implementation Plans:** `docs/implementation-plans/2026-05-17-diary-injection/phase_01.md`, `phase_02.md`, `phase_03.md`

---

## Automated Tests

### diary-injection.AC1: Entry selection

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| Blocks labelled `diary:2026-05-16`, `diary:2026-05-17` are selected from working tier | AC1.1 | Unit | `src/diary/inject.test.ts` | Pure function test — pass mock MemoryBlock array with diary-prefixed labels, assert both appear in output |
| Entries sorted by date descending, most recent selected first | AC1.2 | Unit | `src/diary/inject.test.ts` | Pass blocks in arbitrary order, assert selection picks most recent N and rendered output is chronological (oldest-first) |
| Selection capped at `diary_max_entries` (default 3) | AC1.3 | Unit | `src/diary/inject.test.ts` | Pass 5 blocks with `maxEntries: 3`, assert only 3 most recent entries in result |
| Sub-day labels (`diary:2026-05-17-evening`) sort correctly via lexicographic ordering | AC1.4 | Unit | `src/diary/inject.test.ts` | Pass `diary:2026-05-17`, `diary:2026-05-17-evening`, `diary:2026-05-16` — assert correct selection and render order |
| Single diary entry returns that entry alone | AC1.5 | Unit | `src/diary/inject.test.ts` | Pass one block, assert `DiaryInjection` with single entry returned |

### diary-injection.AC2: Token budget

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| Total injected content <= configured `diary_token_budget` | AC2.1 | Unit | `src/diary/inject.test.ts` | Pass blocks fitting within budget, assert `totalTokens <= tokenBudget` |
| Final entry exceeds remaining budget — truncated, not dropped | AC2.2 | Unit | `src/diary/inject.test.ts` | Pass 2 blocks where second overflows budget. Assert both date headers present, second content shorter than input. Implementation uses `estimateTokens` (`Math.ceil(text.length / 4)`) — construct test content at known char lengths |
| Entry exactly at budget limit is included in full | AC2.3 | Unit | `src/diary/inject.test.ts` | Calculate exact char count that fills budget (accounting for header overhead), assert no truncation indicator (`...`) |
| Single entry larger than entire budget is truncated to budget | AC2.4 | Unit | `src/diary/inject.test.ts` | Pass one oversized block, assert `totalTokens <= tokenBudget` and content ends with `...` |

### diary-injection.AC3: Formatting

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| Output rendered as `## Diary` with `### YYYY-MM-DD` subheaders | AC3.1 | Unit | `src/diary/inject.test.ts` | Assert output starts with `## Diary\n\n`, each entry prefixed with `### {date}\n` |
| Entries rendered in chronological order (oldest first) within selected window | AC3.2 | Unit | `src/diary/inject.test.ts` | Pass blocks in random order, assert date headers in ascending order in rendered output |
| No metadata (scores, labels, tiers) exposed in rendered output | AC3.3 | Unit | `src/diary/inject.test.ts` | Assert output contains none of: `tier:`, `owner:`, `label:`, `embedding`, `permission`, `pinned` |

### diary-injection.AC4: Prompt injection position

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| Diary section appears after core memory blocks in system prompt | AC4.1 | Integration | `src/agent/diary-injection.test.ts` | Create agent with mock model + real `diarySection` string. Capture system prompt from model `complete()` call. Assert `## Diary` appears after core memory content |
| Diary section appears before dynamic context providers and skills | AC4.2 | Integration | `src/agent/diary-injection.test.ts` | Same approach — assert diary section index < skills content index in system prompt string |
| Absent diary (null) produces no section in prompt | AC4.3 | Integration | `src/agent/diary-injection.test.ts` | Create agent without `diarySection` in deps, assert system prompt does NOT contain `## Diary` |

### diary-injection.AC5: Store prefix retrieval

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| `getBlocksByLabelPrefix('agent', 'diary:', 'working')` returns all diary-labelled working-tier blocks | AC5.1 | Integration | `src/memory/postgres-store.test.ts` | Insert diary blocks via `persistence.query()`, call method, assert all returned |
| Blocks with label `diary-notes:foo` (not matching `diary:` prefix) are excluded | AC5.2 | Integration | `src/memory/postgres-store.test.ts` | Insert both `diary:*` and `diary-notes:*` blocks, assert only `diary:*` returned |
| Diary-labelled blocks in core or archival tiers are excluded when tier filter is specified | AC5.3 | Integration | `src/memory/postgres-store.test.ts` | Insert same label in core + working tiers, query with `tier='working'`, assert only working-tier block returned |
| No matching blocks returns empty array | AC5.4 | Integration | `src/memory/postgres-store.test.ts` | Query against empty/non-matching data, assert `[]` |

**Additional integration tests (implementation correctness):**
- Label ordering: results ordered by `label ASC`
- Owner isolation: querying one owner returns only their blocks
- No tier filter: omitting tier returns blocks from all tiers
- Prefix escaping: `%` and `_` in prefix values don't act as SQL wildcards

### diary-injection.AC6: Guard conditions

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| `diary_enabled = false` skips retrieval entirely | AC6.1 | Integration | `src/diary/integration.test.ts` | Set config flag to `false`, verify `getBlocksByLabelPrefix` is never called |
| Empty working tier (no diary blocks) returns null gracefully | AC6.2 | Integration | `src/diary/integration.test.ts` | Ensure no diary blocks in DB, verify agent creation succeeds with no `## Diary` in prompt |
| Store error is caught, logged, and skipped (no crash) | AC6.3 | Integration | `src/diary/integration.test.ts` | Mock/override `getBlocksByLabelPrefix` to throw, verify agent creation succeeds, verify warning logged |

### diary-injection.AC7: Static per session

| Criterion | Sub-ID | Test Type | Test File Path | Notes |
|-----------|--------|-----------|----------------|-------|
| Diary content fetched once at session init | AC7.1 | Integration | `src/diary/integration.test.ts` | Verify `getBlocksByLabelPrefix` called exactly once during agent creation |
| Same diary content injected on every turn within the session | AC7.2 | Integration | `src/diary/integration.test.ts` | Send multiple messages to agent, capture system prompt from each model call, assert diary content identical across turns |
| New diary entries written mid-session don't appear until next session | AC7.3 | Integration | `src/diary/integration.test.ts` | Create agent (diary fetched), insert new diary block, send message, assert new entry NOT in system prompt |

---

## Human Verification

| Criterion | Sub-ID | Justification | Verification Approach |
|-----------|--------|---------------|----------------------|
| *(none)* | — | — | — |

**All acceptance criteria are automatable.** No criteria require subjective judgement, visual inspection, or runtime conditions that cannot be reproduced in test.

---

## Test File Summary

| File | Type | Phase | ACs Covered |
|------|------|-------|-------------|
| `src/memory/postgres-store.test.ts` | Integration (requires PostgreSQL) | Phase 1 | AC5.1, AC5.2, AC5.3, AC5.4 |
| `src/diary/inject.test.ts` | Unit (pure, no I/O) | Phase 2 | AC1.1–AC1.5, AC2.1–AC2.4, AC3.1–AC3.3 |
| `src/agent/diary-injection.test.ts` | Integration (mock model) | Phase 3 | AC4.1, AC4.2, AC4.3 |
| `src/diary/integration.test.ts` | Integration (requires PostgreSQL + agent wiring) | Phase 3 | AC6.1–AC6.3, AC7.1–AC7.3 |

---

## Running All Diary Tests

```bash
# Unit tests (no DB required)
bun test src/diary/inject.test.ts

# Integration tests (requires running PostgreSQL)
bun test src/memory/postgres-store.test.ts
bun test src/agent/diary-injection.test.ts
bun test src/diary/integration.test.ts

# All at once
bun test src/diary/ src/memory/postgres-store.test.ts src/agent/diary-injection.test.ts
```
