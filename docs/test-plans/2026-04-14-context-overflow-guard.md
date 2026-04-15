# Context Overflow Guard — Human Test Plan

## Prerequisites
- Ollama running locally with a small-context model (e.g., `qwen2.5:3b` or any model with 4K-8K context)
- PostgreSQL with pgvector running (`docker compose up -d`)
- Migrations applied (`bun run migrate`)
- All automated tests passing (`bun test`)

## Phase 1: Pre-flight Guard Under Real Token Estimation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml` to use a local Ollama model with `model_max_tokens = 8192` and `context_budget = 0.3` (intentionally low to force the guard to fire) | Config loads without error |
| 2 | Start the daemon: `bun run start` | REPL appears, no errors |
| 3 | Send a long message: paste a ~2000 word block of text as a user message | Agent processes normally |
| 4 | Continue the conversation for 8-10 turns with moderately long responses (ask it to write code, explain concepts, etc.) | Responses continue; watch for `pre-flight guard` in console output |
| 5 | When `pre-flight guard: estimated N tokens exceeds limit M, truncating oldest messages` appears in stderr, confirm no `400` or `413` HTTP errors follow | Warning fires but the request still succeeds -- no oversized request reaches the provider |
| 6 | Check that the conversation remains coherent (the agent may lose early context, but it should not crash or produce gibberish) | Coherent responses continue |

## Phase 2: Compaction Retry Under Real Timeout Pressure

| Step | Action | Expected |
|------|--------|----------|
| 1 | Edit `config.toml`: set `compaction_timeout = 3000` (3 seconds) and use a deliberately slow Ollama model or constrain resources | Config loads |
| 2 | Start the daemon and generate enough conversation to trigger compaction (the `shouldCompress` threshold) | Compaction triggers automatically |
| 3 | Watch logs for retry attempts: `compaction pipeline failed` followed by retry logging | Retry messages appear with decreasing chunk sizes |
| 4 | If retries exhaust, confirm the conversation continues with original history (graceful degradation) | No crash, conversation resumes with full history |
| 5 | Increase `compaction_timeout = 30000` and trigger compaction again | Compaction succeeds normally |

## Phase 3: Token Estimation Drift Validation

| Step | Action | Expected |
|------|--------|----------|
| 1 | Use the Anthropic provider (real API key) with `model_max_tokens` matching the model's actual limit (e.g., 200000 for Sonnet) | Config loads |
| 2 | Set `context_budget = 0.95` (nearly full context window) | Agent has maximum room |
| 3 | Converse until estimated tokens approach the limit, including tool use rounds (which add structured JSON content where the 1-char-per-4-tokens heuristic may diverge from BPE tokenisation) | No `400` errors; the pre-flight guard fires before any request exceeds the real limit |
| 4 | If a `400` error does occur, note the estimated vs actual token count -- this indicates the heuristic needs calibration | Log the discrepancy for tuning |

## End-to-End: Full Lifecycle with Compaction and Guard

| Step | Action | Expected |
|------|--------|----------|
| 1 | Start fresh conversation with `context_budget = 0.4` and `model_max_tokens = 8192` (Ollama) | Agent starts |
| 2 | Generate 20+ turns of conversation including tool use (`execute_code`, `memory_add`) | Messages accumulate |
| 3 | Compaction should trigger when messages exceed `0.4 * 8192 = ~3277` estimated tokens | Compaction fires, older messages replaced with summary |
| 4 | Continue 10 more turns after compaction | Pre-flight guard should NOT fire (compaction reduced context) |
| 5 | If compaction fails (timeout), pre-flight guard should activate as the safety net | Warning logged, request still succeeds with truncated history |
| 6 | Use `memory_read` tool to verify compacted summaries are searchable in archival memory | Summaries appear in search results |

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC3.1 (real-world) | The `length/4` heuristic diverges from actual BPE tokenisation, especially with structured tool call JSON, unicode, and code blocks. Mocks cannot reproduce this drift. | Run Phase 3 above. Monitor for `400`/`413` from the provider. |
| AC2.1 (wall-clock backoff) | Unit tests use `backoffBaseMs: 0` to avoid timing flakiness. Actual exponential backoff (1s, 2s, 4s delays) requires observation. | Run Phase 2 above. Timestamp the retry log messages and confirm delays grow exponentially between attempts. |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1 | `context.test.ts` - "message tokens under budget but with overhead exceeds budget" | -- |
| AC1.2 | `context.test.ts` - `estimateOverheadTokens` suite (3 tests) | -- |
| AC1.3 | `context.test.ts` - "message tokens within budget + overhead returns false" | -- |
| AC1.4 | `context.test.ts` - "zero overhead" tests | -- |
| AC2.1 | `compactor.test.ts` - "retries on timeout error" | Phase 2, Step 3 (wall-clock backoff) |
| AC2.2 | `compactor.test.ts` - "Chunk size is halved on each retry" (capturedRequests) | -- |
| AC2.3 | `compactor.test.ts` - "Chunk size never goes below minimum floor" | -- |
| AC2.4 | `compactor.test.ts` - "Non-retryable errors fail immediately" | -- |
| AC2.5 | `compactor.test.ts` - "timeout passed through to ModelRequest" | -- |
| AC2.6 | `compactor.test.ts` - "Retry exhaustion returns original history" | -- |
| AC3.1 | `agent.test.ts` - "agent never sends oversized request" | Phase 1 + Phase 3 (real token estimation drift) |
| AC3.2 | `context.test.ts` - "preserves leading system messages" | -- |
| AC3.3 | `context.test.ts` - "preserves most recent user message" | -- |
| AC3.4 | `context.test.ts` - "drops oldest non-protected messages first" | -- |
| AC3.5 | `agent.test.ts` - "warning logged when pre-flight guard fires" | Phase 1, Step 5 |
| AC3.6 | `context.test.ts` - "minimum viable context never truncated further" | -- |
| AC4.1 | All 4 adapter test files - "pass timeout when provided" | -- |
| AC4.2 | All 4 adapter test files - "work without timeout" | -- |
| AC4.3 | `anthropic.test.ts` + `ollama.test.ts` - "timeout exceeded produces ModelError" | -- |
