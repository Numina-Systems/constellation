# Test Plan: Continuation Refinements

## Prerequisites
- PostgreSQL running (`docker compose up -d`)
- `bun test` passing (all unit + integration tests green)
- `bun run build` passing (type-check clean)

## Phase 1: Pattern Annotation Verification (AC1)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `grep -n "^// pattern:" src/subconscious/continuation-budget.ts` | Line 1 reads `// pattern: Functional Core` |
| 2 | Run `grep -E "import.*from.*(pg\|node:fs\|fetch)" src/subconscious/continuation-budget.ts` | No output (zero I/O imports) |
| 3 | Inspect imports in `continuation-budget.ts` manually | Only imports are from local types or Zod; no database, network, or filesystem dependencies |

## Phase 2: Zod Parsing Confidence Check (AC2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/subconscious/continuation.test.ts` | All tests pass |
| 2 | Verify test for AC2.3 exists (extra fields) | Test asserts `confidence: 0.9` is silently dropped |
| 3 | Verify test for AC2.6 exists (type mismatch) | Test asserts string `"yes"` triggers Zod rejection |

## Phase 3: Logger Injection Verification (AC3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/subconscious/continuation-loop.test.ts` | All tests pass including AC3.1-AC3.4 |
| 2 | In a running instance, trigger an impulse event and observe log output | All continuation-related log lines prefixed with `[continuation]` |
| 3 | Simulate model timeout by disconnecting network during impulse | Log shows `[continuation] loop error:` with stack trace, impulse completes normally |

## Phase 4: Transaction Boundary Verification (AC4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Run `bun test src/subconscious/continuation-transaction.test.ts` | All 4 integration tests pass (requires PostgreSQL) |
| 2 | During a live multi-round continuation, query `SELECT conversation_id, tool_name, created_at FROM operation_traces ORDER BY created_at DESC LIMIT 10` | All traces from the same continuation share one `conversation_id`; timestamps are monotonically increasing |

## End-to-End: Full Continuation Flow

1. Start the daemon with `bun run start`
2. Wait for next impulse event (or reduce `impulse_interval_minutes` to 1 in config.toml)
3. Observe subconscious log output -- confirm `[continuation]` prefixed messages appear
4. If continuation fires (judge returns `shouldContinue: true`), verify:
   - A second round of tool use occurs in the subconscious conversation
   - Budget counter decrements (visible via continuation log messages showing round count)
   - Traces in `operation_traces` table reflect multiple rounds with same `conversation_id`
5. If continuation does NOT fire, verify:
   - Log shows `[continuation] continuation stopped` with the judge's reason
   - No error in logs; impulse completes normally
6. Kill the LLM provider mid-continuation (simulate network failure) and confirm:
   - Error logged with `[continuation] loop error:` prefix and stack trace
   - Daemon continues operating; next impulse fires on schedule

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 Pattern annotation | -- | Phase 1, Step 1 |
| AC1.2 No I/O imports | -- | Phase 1, Step 2-3 |
| AC2.1 Valid JSON parsing | `continuation.test.ts` | Phase 2, Step 1 |
| AC2.2 Markdown fence stripping | `continuation.test.ts` | Phase 2, Step 1 |
| AC2.3 Extra fields ignored | `continuation.test.ts` | Phase 2, Step 2 |
| AC2.4 Missing field fallback | `continuation.test.ts` | Phase 2, Step 1 |
| AC2.5 Non-JSON fallback | `continuation.test.ts` | Phase 2, Step 1 |
| AC2.6 Type mismatch fallback | `continuation.test.ts` | Phase 2, Step 3 |
| AC2.7 Empty string fallback | `continuation.test.ts` | Phase 2, Step 1 |
| AC3.1 Logger injection | `continuation-loop.test.ts` | Phase 3, Step 2 |
| AC3.2 Console fallback | `continuation-loop.test.ts` | Phase 3, Step 1 |
| AC3.3 Stack trace in errors | `continuation-loop.test.ts` | Phase 3, Step 3 |
| AC3.4 Prefix on all messages | `continuation-loop.test.ts` | Phase 3, Step 2 |
| AC4.1 Correct conversationId | `continuation-transaction.test.ts` | Phase 4, Step 2 |
| AC4.2 Independent atomicity | `continuation-transaction.test.ts` | Phase 4, Step 2 |
| AC4.3 No orphaned traces | `continuation-transaction.test.ts` | Phase 4, Step 1 |
| AC4.4 Graceful error handling | `continuation-transaction.test.ts` | Phase 4, Step 1 |
