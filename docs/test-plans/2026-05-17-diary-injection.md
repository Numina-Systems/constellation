# Human Test Plan: Diary Injection

## Prerequisites
- PostgreSQL running locally (`docker compose up -d`)
- All migrations applied (`bun run migrate`)
- Unit tests passing: `bun test src/diary/inject.test.ts`
- Integration tests passing: `bun test src/memory/postgres-store.test.ts src/agent/diary-injection.test.ts src/diary/integration.test.ts`

## Phase 1: Store Layer (getBlocksByLabelPrefix)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start the daemon: `bun run start` | REPL starts without errors |
| 2 | Create diary blocks via memory tools: write blocks labelled `diary:2026-05-16`, `diary:2026-05-17`, `diary:2026-05-17-evening` to working tier | Blocks created successfully, confirmed via `memory list` |
| 3 | Restart daemon (new session) | Diary blocks are retrieved and shown in system prompt |

## Phase 2: Entry Selection and Formatting

| Step | Action | Expected |
|------|--------|----------|
| 1 | With 3+ diary blocks in working memory, start a new session | System prompt contains `## Diary` section |
| 2 | Observe diary section ordering | Entries appear oldest-first (chronological): `### 2026-05-16` before `### 2026-05-17` before `### 2026-05-17-evening` |
| 3 | Add more than `diary_max_entries` (default 3) diary blocks, restart session | Only the 3 most recent entries appear |
| 4 | Verify no metadata leakage in diary section | Section shows only date headers and content -- no tier/owner/label/embedding references |

## Phase 3: Token Budget Enforcement

| Step | Action | Expected |
|------|--------|----------|
| 1 | Create a diary block with extremely long content (~5000 chars), set `diary_token_budget` to 200 in config | Session starts, diary section present but content truncated with `...` |
| 2 | Verify total diary section token size | Content fits within configured budget (section is visibly shorter than full entry) |

## Phase 4: System Prompt Position

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start session with diary blocks present and skills enabled | System prompt structure shows: core memory -> `## Diary` -> skills/dynamic context |
| 2 | Start session with NO diary blocks in working memory | System prompt has NO `## Diary` section; no errors logged |
| 3 | Set `diary_enabled = false` in config, restart with diary blocks present | System prompt has NO `## Diary` section despite blocks existing |

## Phase 5: Session-Static Behaviour

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start a session (diary loads) | Diary section appears in first response's context |
| 2 | Mid-session, use memory write tool to create a new `diary:2026-05-18` block | Write succeeds |
| 3 | Send another message in the same session | Diary section does NOT include the new `2026-05-18` entry |
| 4 | End session, start new session | New session's diary section now includes `2026-05-18` |

## Phase 6: Error Resilience

| Step | Action | Expected |
|------|--------|----------|
| 1 | Stop PostgreSQL: `docker compose stop` | Database unavailable |
| 2 | Attempt to start the daemon | If diary retrieval fails, daemon still starts (diary section absent), warning logged to console |
| 3 | Start PostgreSQL again: `docker compose up -d` | Next session start retrieves diary normally |

## End-to-End: Full Lifecycle

1. Start fresh (no diary blocks). Start session. Verify no `## Diary` in system prompt.
2. During session, use memory tools to write `diary:2026-05-17` with content "Reflected on the Bluesky firehose integration."
3. Verify diary does NOT appear in current session's prompt (session-static guarantee).
4. End session. Start new session.
5. Verify `## Diary` section appears with `### 2026-05-17` header and content.
6. Write another entry `diary:2026-05-18` with long content (2000+ chars).
7. Verify current session still shows only the `2026-05-17` entry.
8. End session, reduce `diary_token_budget` to 100 in config, start new session.
9. Verify both entries present but the content is truncated to fit within budget.
10. End session, set `diary_max_entries: 1`, start new session.
11. Verify only the most recent entry (`2026-05-18`) appears.

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1: diary: label selection | `src/diary/inject.test.ts` | Phase 2 Step 1 |
| AC1.2: date sorting + chronological render | `src/diary/inject.test.ts` | Phase 2 Step 2 |
| AC1.3: maxEntries cap | `src/diary/inject.test.ts` | Phase 2 Step 3 |
| AC1.4: sub-day label ordering | `src/diary/inject.test.ts` | Phase 2 Step 2 |
| AC1.5: single entry | `src/diary/inject.test.ts` | E2E Step 5 |
| AC2.1: token budget respected | `src/diary/inject.test.ts` | Phase 3 Step 2 |
| AC2.2: truncation over omission | `src/diary/inject.test.ts` | Phase 3 Step 1 |
| AC2.3: exact budget fit | `src/diary/inject.test.ts` | -- |
| AC2.4: oversized single entry truncated | `src/diary/inject.test.ts` | Phase 3 Step 1 |
| AC3.1: markdown header format | `src/diary/inject.test.ts` | Phase 2 Step 1 |
| AC3.2: chronological render order | `src/diary/inject.test.ts` | Phase 2 Step 2 |
| AC3.3: no metadata leakage | `src/diary/inject.test.ts` | Phase 2 Step 4 |
| AC4.1: after core memory | `src/agent/diary-injection.test.ts` | Phase 4 Step 1 |
| AC4.2: before dynamic/skills | `src/agent/diary-injection.test.ts` | Phase 4 Step 1 |
| AC4.3: absent diary = no section | `src/agent/diary-injection.test.ts` | Phase 4 Step 2 |
| AC5.1: prefix retrieval returns matching | `src/memory/postgres-store.test.ts` | Phase 1 Step 2-3 |
| AC5.2: non-matching prefix excluded | `src/memory/postgres-store.test.ts` | -- |
| AC5.3: tier filter respected | `src/memory/postgres-store.test.ts` | -- |
| AC5.4: empty returns [] | `src/memory/postgres-store.test.ts` | Phase 4 Step 2 |
| AC6.1: diary_enabled=false skips | `src/diary/integration.test.ts` | Phase 4 Step 3 |
| AC6.2: empty tier = graceful null | `src/diary/integration.test.ts` | Phase 4 Step 2 |
| AC6.3: store error caught gracefully | `src/diary/integration.test.ts` | Phase 6 Step 2 |
| AC7.1: fetched once at init | `src/diary/integration.test.ts` | Phase 5 Step 1 |
| AC7.2: same content every turn | `src/agent/diary-injection.test.ts` | Phase 5 Step 3 |
| AC7.3: mid-session writes invisible | `src/diary/integration.test.ts` | Phase 5 Steps 2-4 |
