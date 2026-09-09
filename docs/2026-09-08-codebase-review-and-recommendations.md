# Constellation codebase review and recommendations

Date: 2026-09-08
Status: Review findings and proposed remediation; no application fixes implemented by this report.

## Executive summary

Constellation has useful foundations: injected ports and factory functions, functional decision modules, explicit PostgreSQL transactions, granular default Deno permissions, and focused tests. The highest risks are incomplete boundaries between these components: authorization on deletion, asynchronous execution after timeout, conversation interleaving, and compaction that changes durable state before replacement is safely committed.

Prioritize data integrity and protocol correctness before summary-prompt tuning or introducing more concurrency. Polytoken provides concrete examples for compaction admission, protocol-aware shaping, typed tool outcomes, lifecycle ownership, and tests of actual production wiring. Adapt those contracts to Bun, TypeScript, PostgreSQL, and Deno; do not copy its Rust infrastructure wholesale.

This report consolidates **17 distinct findings: 8 High and 9 Medium**. Severity describes potential impact; remediation priority also accounts for dependencies. No Blocker was assigned. None of the findings has been runtime-reproduced as part of these reviews.

## Scope, provenance, and evidence limits

Three subagents using `codex/gpt-6-astra(high)` contributed:

- **standard:** balanced source review across correctness, errors, security, concurrency, performance, compatibility, tests, and maintainability.
- **adversarial:** targeted review of sandbox streams, host dispatch lifetime, custom-tool validation, and relevant tests/callers.
- **comparative:** local examination of sibling `../polytoken/`, with additional investigation of Constellation compaction.
- **both:** overlapping standard and adversarial findings, merged rather than repeated.

No PR or baseline diff was supplied. References are **current-source line numbers observed during review**, not new-side diff lines and not claims about newly introduced changes. Neither repository was pinned to a commit for this report; re-resolve symbols and line ranges before implementation. Polytoken references are local sibling paths, not permanent public citations.

Reviewers read source and test bodies without modifying files, running tests/builds, making database calls, or posting externally. This was risk-focused, not exhaustive. The subsequent documentation pass checked `package.json`, `tsconfig.json`, existing context files, module exports, persistence types, and representative test prerequisites. It did not independently reproduce every finding. Runtime/API consequences below remain **unverified** where noted. No failing-session logs were supplied, so this report does not establish the cause of the operator's observed compaction incidents.

The initial repository snapshot contained unrelated untracked design/implementation documents. Those are not review changes and were left untouched.

## Finding index

| ID | Severity | Source | Location | Finding |
|---|---|---|---|---|
| R01 | High | standard | `src/memory/manager.ts:193–203` | Deletion bypasses ownership and permission checks. |
| R02 | High | adversarial | `src/runtime/executor.ts:302` | Buffered host calls can start after timeout returns. |
| R03 | High | both | `src/runtime/executor.ts:294–300,345–346` | Raw stdout/stderr bypass output budgets. |
| R04 | High | standard | `src/agent/agent.ts:185–199` | Concurrent ingress shares an unserialized agent lifecycle. |
| R05 | High | standard | `src/agent/context.ts:218–247` | Emergency truncation can orphan tool results. |
| R06 | Medium | adversarial | `src/custom-tool/manager.ts:70` | Invalid persisted metadata poisons generated stubs. |
| R07 | Medium | standard | `src/agent/agent.ts:130–135,168–182` | Checkpoint producers read a stale separate state reference. |
| R08 | Medium | standard | `src/agent/agent.ts:168–182` | Interval checkpointing is not wired. |
| R09 | Medium | standard | `src/agent/checkpoint-restore.ts:20–50,86–95` | Restore constraints contradict accepted live/saved state. |
| R10 | Medium | standard | `src/agent/agent.ts:539–543` | Tool errors disappear before the next model request. |
| R11 | High | comparative | `src/compaction/compactor.ts:808–856` | Main history replacement is not transactional. |
| R12 | High | comparative | `src/compaction/compactor.ts:539–580` | Recursive archive replacement deletes sources first. |
| R13 | High | comparative | `src/compaction/compactor.ts:609–615` | Empty summaries can replace real history. |
| R14 | Medium | comparative | `src/compaction/compactor.ts:716–731` | An open compaction breaker cannot recover. |
| R15 | Medium | comparative | `src/agent/agent.ts:201–223` | Trigger context differs from actual per-round context. |
| R16 | Medium | comparative | `src/compaction/compactor.ts:172–191` | Importance ordering and projection lose chronology/provenance. |
| R17 | Medium | comparative | `src/compaction/compactor.ts:645–705` | Chunk shrinking cannot guarantee request fit. |

## Detailed findings

### R01 — High: memory deletion bypasses protection

**Evidence.** The handler at `src/tool/builtin/memory.ts:196–203` calls `manager.deleteBlock(id)`. The manager logs and deletes without loading the block or checking owner and readonly/familiar/append permissions. `src/memory/postgres-store.ts:242–245` deletes solely by ID.

**Impact.** The agent can list protected core-block IDs, delete a protected block, and recreate its label as writable memory. This bypasses the approval boundary enforced for ordinary writes. A known foreign ID also reaches an unscoped delete; exposure of foreign IDs in a particular deployment is unverified.

**Recommendation.** Centralize deletion authorization before any mutation. Reject protected deletion or require an explicit human-approved flow. Preserve owner scoping at the store boundary as defense in depth.

**Acceptance evidence.** Exercise the actual tool → manager → store path for readonly, familiar, append-only, and foreign-owned blocks. Assert no rows or side effects change on rejection. Existing manager deletion tests around `:600–637` cover ordinary working-block deletion and event foreign keys, not authorization.

### R02 — High: host effects can start after sandbox timeout

**Evidence.** Timeout at `src/runtime/executor.ts:217–223` marks state and kills Deno. The race at `:355–359` returns without cancelling the stdout reader. That reader awaits dispatch at `:251–254,302–316`, catches response errors at `:317–322`, and continues without a timed-out gate. The Deno bridge writes requests before awaiting responses (`src/runtime/deno/runtime.ts:107–129`).

**Failure sequence.** Two calls are queued. The first host handler remains pending past timeout. Execution returns and cleans up. When that handler finishes, the reader can dispatch the second, previously unstarted mutation. This can overlap a retry or later turn. Live timing was not reproduced.

**Recommendation.** Define a closed/aborted execution state and check it before every dispatch. Drop buffered requests on termination, stop readers, and propagate cancellation to cooperative handlers. Distinguish already-started uncancellable effects from requests that must never start.

**Acceptance evidence.** Use a deferred first handler and a second mutation. Time out, release the first handler, and assert the second never starts. Existing timeout tests at `executor.test.ts:285–302` cover an infinite child loop, not host-handler lifetime.

### R03 — High: raw streams bypass output limits

**Evidence.** `max_output_size` is checked for parsed `__output__` messages at `src/runtime/executor.ts:228–236`. Raw stdout grows `buffer` at `:294–300`; stderr grows `stderrOutput` at `:344–347`. Newline-free stdout repeatedly processes a growing unterminated frame. Child stdio needs no extra Deno filesystem/network permission.

**Impact.** Host memory and parsing work can exceed the configured cap until timeout. Daemon OOM is plausible but unverified; no destructive reproduction was attempted.

**Recommendation.** Count bytes on both streams before concatenation/decoding/parsing. Bound individual frames and retained stderr, then terminate both the child and processing on overflow. Keep diagnostic output bounded too.

**Acceptance evidence.** Test raw newline-free stdout, stderr floods, oversized frames, malformed IPC, and cooperative output. Existing `executor.test.ts:319–335` only exercises repeated `output()` calls.

### R04 — High: turns share state without one serialization boundary

**Evidence.** External and scheduler queues use different processing flags but call the same agent (`src/index.ts:1443–1449,1494–1500`). Prediction review calls `processEvent` directly at `:1536`; the REPL is another caller. `src/agent/agent.ts:185–199` does not serialize the full lifecycle.

**Impact.** Concurrent turns persist input, load history, and mutate turn/snapshot/loop state independently. A turn awaiting a tool can have its messages interleaved with another turn, which may observe an unanswered assistant tool call. Exact provider failures remain unverified.

**Recommendation.** Put one awaitable per-agent queue around complete turns, regardless of ingress source. Define cancellation and reentrancy behavior; avoid recursively acquiring the same queue from internal work.

**Acceptance evidence.** Overlap real entry points with deferred tool handlers and inspect persisted ordering and successive provider requests. Test queue release after errors and cancellation.

### R05 — High: emergency truncation breaks tool exchanges

**Evidence.** `buildMessages` maps tool results to user-role blocks (`src/agent/context.ts:82–94`). `truncateOldest` at `:218–247` protects the final user-role message rather than the real user request and complete tool exchange. It can remove the matching assistant call and leave an orphan result. The agent calls this before completion (`agent.ts:317–331`); Anthropic forwards surviving blocks without repair (`src/model/anthropic.ts:142–147,179–188`).

**Impact.** The constructed history can violate provider protocol and lose the user's request. Live API rejection was not tested.

**Recommendation.** Represent atomic conversational exchanges and remove whole groups. Retain matching calls/results and the actual user input. If mandatory context cannot fit, return an explicit capacity error rather than malformed history.

**Acceptance evidence.** Force truncation during a tool round and inspect the actual next provider request. Assert correlation, ordering, and retention of the user objective. The existing array-content test at `context.test.ts:384–402` is within budget.

**Distinction.** Compactor keep/compress splitting already protects its boundary (`compactor.ts:167–170`). That strength does not repair this separate emergency path.

### R06 — Medium: custom metadata can break all sandbox scripts

**Evidence.** `src/custom-tool/manager.ts:70–88` checks duplicate names but persists/registers other invalid metadata. Agent-facing handlers stringify/cast parameter fields (`src/tool/builtin/custom-tools.ts:19–29,74–81`). `src/tool/registry.ts:53–56,144–149` interpolates identifiers into generated TypeScript.

**Impact.** A name such as `my-tool`, or parameter `foo-bar`, creates invalid syntax. Shared stubs are included in ordinary and custom executions (`agent.ts:497–502`, `custom-tool/manager.ts:46–48`); `loadAll` at `:117–127` reloads persisted invalid definitions. Upstream model rejection is unverified and unnecessary to the script-generation defect.

**Recommendation.** Validate identifiers, reserved/runtime names, parameter types, uniqueness, and required/enum shapes before writes and at load. Keep persistence/registry changes atomic; quarantine invalid stored definitions. Encode names safely wherever dynamic property access is appropriate.

**Acceptance evidence.** Assert invalid create/update leaves storage and registry unchanged; verify generated-script parseability. The test named “create_tool validates parameters” (`custom-tools.test.ts:159–181`) supplies valid inputs, and `manager.test.ts:155–167` only checks stub substrings.

### R07 — Medium: checkpoint state has two owners

**Evidence.** `src/agent/agent.ts:130–135` creates a private reference and zeroed counters rather than consuming the injected state. The composition root restores `agentStateRef` at `src/index.ts:1183–1212`, passes it at `:1316`, and checkpoint creation reads it at `:1236–1241`. Agent updates at `agent.ts:168–182` affect the other reference.

**Impact.** Explicit/pre-compaction checkpoints can preserve stale counters and empty message IDs, while resumed counters restart from zero.

**Recommendation.** Use one shared state source and initialize from restored state. Refresh it before every checkpoint trigger, including relevant current tool-round state. Coordinate this with the history transaction design in R11.

**Acceptance evidence.** Process real turns and tools, trigger explicit/pre-compaction checkpoints, reload, and assert message IDs and resumed counters—not just serialization of a hand-built state object.

### R08 — Medium: interval checkpoints never trigger

**Evidence.** `src/agent/agent.ts:168–182` updates state but leaves interval triggering as future work. It does not read `checkpoint_interval` or call `checkpointFn('interval')`.

**Impact.** Recovery relies on other triggers despite configured periodic checkpointing.

**Recommendation.** Trigger nonzero intervals at completed turn boundaries using current state and explicit failure handling.

**Acceptance evidence.** Drive actual turns and assert exact callback counts for enabled/disabled intervals. `src/agent/checkpoint-triggers.test.ts:407–442` invokes `performCheckpoint('interval', ...)` directly at `:435–436`, so does not test the missing wiring.

### R09 — Medium: restore rejects supported live state

**Evidence.** Normal memory writes (`src/memory/manager.ts:92–175`) and checkpoint schemas (`src/agent/checkpoint-types.ts:91–94,134`) accept states rejected only by `checkpoint-restore.ts:20–50,86–95`: more than 20 working blocks, labels outside `/^[a-z][a-z0-9_-]*$/`, or content over 10,000 characters.

**Impact.** A successful normal write and checkpoint can cause startup resume to fail (`src/index.ts:1205–1220`).

**Recommendation.** Define one versioned live/save/restore contract. If tighter limits are desired, specify migration or compatibility handling for already-supported persisted state.

**Acceptance evidence.** Round-trip actual writes through checkpoint and restore for colon-bearing labels, large content, and 21 blocks. Existing restore tests reject long content but do not prove compatibility with writes.

### R10 — Medium: model loses tool-error details

**Evidence.** `registry.dispatch` returns `{success:false, output:'', error:...}` on ordinary failures (`src/tool/registry.ts:84–139`). `src/agent/agent.ts:539–543` retains only output and persists it at `:559–565`. `src/agent/context.ts:91` infers error status from a content substring.

**Impact.** The next model request contains blank, apparently non-error results for invalid arguments, missing tools, and handler exceptions. Traces alone retain the reason.

**Recommendation.** Preserve typed success/error/cancel outcomes through persistence and provider lowering. At minimum serialize failure details; do not derive protocol status from natural-language text.

**Acceptance evidence.** Use the real registry with a throwing handler and invalid arguments; inspect correlation IDs, error status, and explanatory content in the next request.

### R11 — High: compaction history replacement is not atomic

**Evidence.** `src/compaction/compactor.ts:808–856` archives summaries, deletes old messages at `:835–838`, and inserts the clip summary at `:853–856` using independent queries. The catch at `:885–908` returns original in-memory history even if earlier writes committed.

**Impact.** Insert failure after deletion leaves durable history different from the returned history. Later failures can leave archive artifacts from an attempt reported as failed. Failure injection was not run.

**Recommendation.** Generate and validate model output outside a transaction, then commit archive changes and visible-history replacement through one persistence boundary against an expected history revision. Publish in-memory/cache state only after commit. Consider visibility epochs or retained originals instead of deletion so checkpoints remain recoverable.

**Acceptance evidence.** Inject failures before/after every write, reload from storage, and assert old-or-new state, never a mixture. A checkpoint containing deleted message IDs is not sufficient recovery; test pre-compaction restoration explicitly.

### R12 — High: recursive archive replacement deletes its inputs

**Evidence.** `src/compaction/compactor.ts:539–580` directly calls the model at `:549`, deletes source blocks at `:564–568` to avoid a label collision, then writes replacement at `:575–580`. That direct model call bypasses the configured chunk retry/timeout helper.

**Impact.** Replacement-write failure removes source archives without a replacement. Recursive requests also lack the same deadline/budget handling as ordinary chunk summarization.

**Recommendation.** Validate replacement first, then atomically replace source blocks using safe identity/version semantics. Share request-budget, retry, cancellation, and deadline logic across initial and recursive summarization.

**Acceptance evidence.** Fail replacement persistence and prove originals remain retrievable. Test recursive timeout, capacity failure, empty output, and restart after successful replacement.

### R13 — High: empty summaries are committed

**Evidence.** `src/compaction/compactor.ts:609–615` joins text blocks without rejecting empty/whitespace output. Recursive summarization at `:549–553` has the same behavior.

**Impact.** The pipeline can archive empty content and delete meaningful inputs while reporting success.

**Recommendation.** Validate substantive summary content before any destructive operation. Use a bounded retry for empty output, with an explicit terminal failure if retries exhaust. Never reuse a partial failed attempt as successful output.

**Acceptance evidence.** Return empty, whitespace, and non-text-only model responses for both summary paths. Assert bounded calls and unchanged source messages/archives on terminal failure.

### R14 — Medium: the breaker stays open permanently

**Evidence.** `src/compaction/compactor.ts:716–731` returns immediately once the failure cap is reached. Reset at `:877` requires success that is then unreachable. The returned interface at `:912–916` exposes no reset/half-open mechanism. Production constructs a long-lived instance (`src/index.ts:1004–1034`).

**Impact.** A transient burst of failures disables compaction for the instance lifetime, potentially forcing later turns into emergency truncation.

**Recommendation.** Define CLOSED/OPEN/HALF_OPEN behavior with bounded cooldown or explicit operator retry. Classify failures so storage/auth/protocol problems are not blindly treated as transient capacity errors.

**Acceptance evidence.** Open the breaker, advance an injected clock or request explicit recovery, and prove a successful probe restores operation. Existing `compactor.test.ts:2504–2560` tests suppression; `:2562–2615` resets after a below-threshold failure, not recovery from OPEN.

### R15 — Medium: trigger and actual request see different context

**Evidence.** `src/agent/agent.ts:201–223` checks once before the loop with a preliminary prompt plus tools/output allowance. Diary is added at `:239–242`, skills at `:282–300`, and fresh memory/message context at `:315`. The per-round guard at `:317–331` truncates instead of revisiting automatic compaction.

**Impact.** Later additions or a large tool result can exceed capacity without another compaction admission decision. Whether this explains the reported incidents requires logs.

**Recommendation.** Compute a shared request budget from fully assembled context before each provider call. At safe tool-batch boundaries, allow a bounded compaction attempt; reject irreducible oversized context without entering a compaction loop.

**Acceptance evidence.** Force capacity pressure from diary, skills, and a tool result individually. Assert admission uses actual context and never emits a known-oversized or protocol-invalid request.

### R16 — Medium: summarization loses causal ordering

**Evidence.** `src/compaction/compactor.ts:172–191` sorts individual compressible messages by importance. Batches use first/last sorted timestamps at `:793–801`. `src/compaction/prompt.ts:49–65` projects assistant content and generic tool-result text without call IDs/names/arguments.

**Impact.** Summary input can distort chronology and tool causality; batch metadata can describe the sorted order rather than the actual temporal span. Specific factual summary corruption is unverified.

**Recommendation.** Use importance to select complete groups, then feed selected groups chronologically. Preserve bounded tool provenance and compute temporal bounds from actual timestamps. Keep deterministic continuation separate from narrative summary.

**Acceptance evidence.** Use interleaved high/low-importance messages with call/result pairs and out-of-order timestamps. Assert chronology, valid spans, and useful tool metadata in the summarizer request.

### R17 — Medium: shrinking chunk counts is not a fit guarantee

**Evidence.** `src/compaction/compactor.ts:645–705` halves counts/budgets for timeout or message-string-classified context errors, floors the budget at 100, and folds prior summaries between retry subchunks. `maxChunkTokens` is optional (`src/index.ts:1022–1025`). `compactor.test.ts:2491–2500` deliberately permits a single oversized message as an oversized chunk.

**Impact.** Smaller message counts cannot fix one enormous payload or fixed prompt. Repeated model requests can remain impossible to fit. Live rejection was not reproduced.

**Recommendation.** Account for the selected summarizer window, system/directive/prior-summary overhead, output reserve, and safety margin. Re-estimate after every transformation. Bound or externalize an oversized payload while retaining provenance, or return an explicit unfittable outcome without calling the provider.

**Acceptance evidence.** Assert zero calls for irreducible oversized fixed context; test giant single results, summary growth across retries, and different inference/summarizer windows.

## Polytoken examples worth adapting

All paths in this section are relative to `../polytoken/`. Line references were inspected by the comparative reviewer. These are mechanisms and test examples, not assertions that Polytoken has no defects.

### Compaction admission and safe points

- `rs/polytoken-daemon/src/agent_loop/compaction_strategy.rs:98–171` combines provider occupancy and local estimates.
- `rs/polytoken-daemon/src/agent_loop/run_with_compaction.rs:1312–1353` drains pending model-requested compaction before another provider request; `:256–310` arbitrates threshold compaction.
- `rs/polytoken-daemon/src/compaction/orchestrator.rs:940–1002` uses the turn slot for manual compaction; normal admission is wired in `routes/prompt.rs:528,638–648`.

**Transfer:** a single agent-owned serial executor and deferred compaction intent, consumed only after tool results are durable. Separate ingress queues are not sufficient. A comment about unanswered-tail suppression in the strategy file lags actual logic; copy the tested behavior, not the comment.

### Budgeting, shaping, and final fit

- `compaction/orchestrator.rs:182–196` reserves output capacity and a safety margin; `:362–397` stubs tool text without losing IDs/error status.
- `:412–462` preserves assistant/tool-result boundaries while shortening a suffix.
- `:585–632` shapes provider history and removes private reasoning; `:659–716` rechecks fit and returns an unfittable outcome without spending provider calls on impossible input.
- `agent_loop/history.rs:734–847` contains shared history filtering and correlated repair diagnostics.
- Tests at `orchestrator.rs:3610–3678` assert paired-call survival; `:5827–5904` assert zero provider calls for an unfit request through the real held-slot orchestrator.

**Transfer:** typed exchange groups plus provider-bound validation and one budget object. Mandatory protocol context may exceed a soft target; the final hard check must still prevent an invalid call. Choose safety margins for Constellation rather than copying constants. Polytoken disables local gating when reserve consumes the window; that is a limitation, not the desired Constellation policy.

### Summary failure and cancellation

- `compaction/orchestrator.rs:468–474` classifies retries; `:2088–2130` rejects empty summaries and retries with stronger instruction.
- Calls/stream consumption race cancellation and shutdown at `:1845,1953–1986`.
- `rs/polytoken-integration-tests/tests/compaction.rs:3288–3345` asserts empty-summary retry and completion; `:3562–3637` tests cancellation during a retry after error/hang. The latter accepts Cancelled or Failed, not one exact terminal classification.

**Transfer:** bounded retries, per-attempt accumulation, explicit terminal states, and cancellation propagated through all phases. The inspected Polytoken stream loop has no independent idle/deadline branch. Retain Constellation's deadline capability and extend it to recursive summaries and backoff. Dropping a Rust future is not equivalent to cancelling a JavaScript promise.

### Durable history and continuation

- `compaction/orchestrator.rs:2475–2534` appends a typed compaction boundary and reminders in one history transaction batch, retaining original transcript in append-only history.
- `rs/polytoken-daemon/src/history_tx.rs:301–406` rolls back memory, token cache, usage, and durable prefix after append failure; failed repair latches an inconsistent state.
- Tests at `history_tx.rs:972–1080` verify those surfaces and fail-closed behavior.
- `compaction/canonical.rs:24–73`, `tail.rs`, and `reassemble.rs` preserve bounded narrative plus structural continuation. `canonical.rs:166–214` tests layout and escaping.
- After commit, `orchestrator.rs:2537–2622` resets usage/cache tracking and maintains estimates separately from subsequent actual usage.

**Transfer:** one commit boundary for history, archive, revision, and checkpoint metadata; publish cache/snapshot invalidation only after success. PostgreSQL can provide stronger transaction guarantees than application-level file reconciliation. Retain pre-compaction originals if checkpoints must restore their IDs. Keep objective, constraints, tool status, and active work in deterministic continuation rather than trusting narrative alone.

### Other requested topics

| Topic | Production examples | Inspected tests and adaptation |
|---|---|---|
| Subagents | `rs/polytoken-daemon/src/tools/subagent.rs:1110–1167`; `subagent_runner.rs:309–414,598–710,792–854` | `subagent_runner.rs:1792–1892` makes correlated non-error exit results authoritative and excludes daemon notes/failed tool output from fallback. Use isolated histories, explicit result schemas, job reservation, and cancellation. Shared providers/permission stores mean this is not a security sandbox. |
| MCP | `rs/polytoken-daemon/src/lib.rs:3093–3112`; `rs/polytoken-mcp/src/lifecycle.rs:2008,2068–2160`; `tool_adapter.rs:123–158,230–298` | `lifecycle.rs:2379–2460` checks real HTTP pagination, runaway discovery timeout, and page-two transport failure. Bound the entire discovery operation, use generation-aware errors, preserve schema/error semantics. Constellation already paginates at `src/mcp/client.ts:136–157`. Polytoken's text-only mapping and lack of remote rollback on timeout are not patterns to copy. |
| Tool batches | `rs/polytoken-daemon/src/agent_loop/tool_batch.rs:39–103`; production plan/execute at `run_with_compaction.rs:3552,4032` | `tool_batch.rs:289–349` asserts exclusivity and correlated error results for rejected/overflow calls. Preserve typed outcomes end-to-end and finish the batch before control transitions. |
| Tool flow | `rs/polytoken-daemon/src/tool_flow/dispatch.rs:13–201,258–327` | `dispatch.rs:586–651` checks ordered state deltas and reduced nested capabilities. Freeze authorized tool definitions, validate inputs, inherit absolute deadlines/cancellation, and deny late dispatch. This does not require replacing Deno with Polytoken's interpreter. |
| Providers/retries | `rs/polytoken-daemon/src/agent_loop/retry.rs:116–192`; `stream_consumer.rs:112`; `usage.rs:74–115,170–190` | `retry.rs:853–884` checks capped retry hints/jitter. `usage.rs:312–356` checks API-family cache accounting. Use typed retry taxonomy and distinguish inclusive input-token counts from separate Anthropic cache buckets. Interactive retry timing may not fit a scheduled daemon. |
| Prompt caching | `rs/polytoken-providers/src/anthropic/request.rs:77`; `anthropic/cache.rs:54–100`; `rs/polytoken-daemon/src/cache_tracking.rs:41–89`; `run_with_compaction.rs:638` | `anthropic/tests/mod_tests.rs:3001–3066` serializes the actual request and checks three breakpoint placements. `cache_tracking.rs:341–366` checks stability under ordinary history growth. Keep Constellation's dimension diagnostics, add wire-level tests and observed metrics, and do not equate fingerprints with guaranteed cache reuse. |
| Organization | `compaction/canonical.rs`, `agent_loop/tool_batch.rs`, `usage.rs`, `cache_tracking.rs`, `history_tx.rs` | Small pure cores behind explicit orchestration/storage owners fit Constellation's FCIS/factory conventions. Polytoken's roughly 6,000-line compaction orchestrator and larger loop are not examples to imitate. |

## Recommended remediation sequence

These are proposed work packages, not approved implementation or completed fixes. Changes to retention, schemas, and recovery semantics need design decisions before coding.

### P0: stop destructive or unauthorized outcomes

- Fix R01 deletion authorization independently of compaction work.
- Fix R02/R03 sandbox lifetime and stream budgets; no new host call may start after execution closure.
- Address R11/R12/R13 together: valid replacement first, transactional commit, originals preserved on failure.
- Reconcile R07 checkpoint ownership and decide whether original messages remain recoverable through retained rows or visibility epochs.
- Add failure injection and reload-equivalence tests before replacing existing persistence behavior.

**Exit criteria:** protected memory cannot be deleted; execution closure gates future effects; failed compaction leaves usable original state; empty summaries cannot commit.

### P0: serialize and preserve protocol

- Address R04 with one owner for all ingress.
- Defer compaction until tool-batch results are durable.
- Address R05 with exchange-aware shaping and provider-bound validation.
- Preserve the existing compactor split-boundary protection while replacing role/string heuristics elsewhere.

**Exit criteria:** overlapping ingress cannot interleave active turns; every provider-visible result has its matching call; irreducible oversized context fails explicitly.

### P1: align budgets, recovery, and checkpoint contracts

- Address R15/R17 with one fully assembled request-budget contract for inference, initial summaries, and recursive summaries.
- Address R14 with bounded recovery and error categories rather than permanent suppression.
- Apply deadlines/AbortSignal through provider calls, stream reads, retry waits, recursive work, and host dispatch where supported.
- Implement R08 using actual completed-turn state; resolve R09 with shared versioned validation.
- Log compaction intent, trigger source, stage, attempt, reason, revision, before/after occupancy, and terminal outcome. Exclude secrets and raw sensitive content.

**Exit criteria:** open breakers can recover safely; capacity tests use selected model windows; interval tests drive the agent; every supported saved state can restore.

### P1: improve causal continuation and tool outcomes

- Address R10 with typed persisted outcomes and R16 with chronological group selection/provenance.
- Preserve current objective, constraints, recent tool status, and outstanding work separately from LLM prose.
- Tie snapshot/cache invalidation to successful history commit and keep estimates separate from actual usage.
- Address R06 validation at creation, update, load, and code generation boundaries.

**Exit criteria:** failures are visible to the model; compaction preserves causal context; invalid metadata cannot persistently disable unrelated tools.

### P2: extend lifecycle patterns only after foundations hold

- Add generation-aware MCP handling and whole-operation discovery bounds where missing.
- Add request serialization/cache-placement contract tests across provider families.
- Introduce general-purpose subagents only with isolated conversation state, explicit result authority, and lifecycle/cancellation ownership.
- Extract pure policy modules when they reduce coupling; retain the current runtime and architecture.

## Validation strategy

Use focused source-level regression tests plus integration tests at actual boundaries. A helper test is insufficient when the defect is missing wiring.

| Boundary | Required assertions |
|---|---|
| Persistence | Inject each write failure; reload old-or-new state; verify archive inputs and checkpoint references remain usable. |
| Agent admission | Concurrent external/scheduled/REPL entry, deferred tools, error/cancellation queue release, ordered durable messages. |
| Provider request | Tool-call/result correlation, true user input retained, final capacity check, typed failure status. |
| Summary requests | Empty/whitespace/non-text output, huge fixed prompt, one oversized payload, recursive retries/deadlines. |
| Breaker | Threshold trip, bounded suppression, half-open/manual recovery, successful reset after OPEN. |
| Sandbox | Raw stdout/stderr bounds, malformed frames, queued dispatch after timeout, already-started handler outcome. |
| Checkpoints | Real turn-trigger counts; live write → save → restore; pre-compaction checkpoint recovery. |
| Custom tools | Invalid metadata rejected without partial writes; generated scripts parse; invalid persisted definitions isolated. |
| Cache/provider usage | Serialized cache-marker placement, API-family token counts, stable normal growth, reset only after committed replacement. |

Run type-checking with `bun run build`; it is `tsc --noEmit`, not a production bundle, and excludes `src/runtime/deno/**`. Run targeted `bun test` files first. Inspect test setup before broader execution: Deno integration tests spawn real subprocesses; database tests can create, truncate, and drop tables. Use an isolated disposable database, not an operational daemon database. Report tests actually run separately from tests inspected or skipped.

## Evidence needed for the reported compaction incidents

Request sanitized artifacts rather than raw secret-bearing configuration:

1. One failing session's timeline and exact error, including whether failure happened before/after a tool batch, recursive summarization, or restart.
2. Selected inference and summarization models, context windows, output reservations, effective chunk/keep-recent settings, timeout/retry settings, and breaker state.
3. Provider usage and local estimates immediately before admission and final request construction.
4. Compaction stage and storage outcome, with message counts/revisions and checkpoint trigger—not secret values or unredacted memory content.
5. Concurrent external/scheduled/REPL activity and any timeout/retry overlap.

These distinguish protocol rejection, capacity failure, permanent breaker suppression, partial persistence failure, and summary-quality loss. Do not attribute an incident to one finding solely because the code path exists.

## Design questions for remediation

These do not block recording the findings, but should be resolved before implementation:

- Must checkpoints restore the exact pre-compaction transcript, and for how long should originals be retained?
- When mandatory context cannot fit, should the daemon pause for intervention or return an explicit failed turn to its scheduler? It should not silently discard protocol obligations.
- What cooldown/manual retry policy should recover compaction after transient failures, and which errors should require intervention?
- What outcome should users see for a timed-out execution with an already-started uncancellable external effect?

## Existing strengths to preserve

- Injected domain ports, factories, module barrels, and small pure context/continuation helpers.
- Explicit PostgreSQL transaction and nested-savepoint support behind `PersistenceProvider`.
- Centralized ordinary memory-write approval and readonly checks.
- Granular default Deno permissions, host-side tool-call counting, escaped credential values, and temporary-file cleanup.
- Parameterized owner-scoped custom-tool storage and existing MCP pagination.
- Snapshot reset/cache-bust diagnostics and the compactor's keep/compress boundary protection.
- Real-Deno tests and focused unit/integration coverage, strengthened by production-wiring assertions rather than replaced wholesale.

## Remediation status (2026-09-09)

The original findings and source-review provenance above are preserved. The status below records accepted implementation and named regression evidence; it does not convert source inspection into an operational incident reproduction. Deterministic unit, fake-port, in-memory, loopback, and wiring tests passed as recorded in the execution ledger. PostgreSQL integration scenarios are wired but remain prerequisite-gated without `TEST_DATABASE_ADMIN_URL`; no production database, live provider, deployment, or historical incident was reproduced.

| Finding | Status | Named passing regression evidence | Evidence boundary |
|---|---|---|---|
| R01 | Implemented/tested | `memory_delete_authorization_matrix`, `memory_delete_permission_race`, `maintenance_owner_tier_boundaries` | Real PostgreSQL race execution remains gated. |
| R02 | Implemented/tested | `queued_host_call_never_starts_after_timeout`, `cancelled_execution_cleanup_is_bounded`, `late_host_completion_is_observed_only` | Deterministic runtime-process seam; no production incident reproduction. |
| R03 | Implemented/tested | `runtime_raw_stream_budget_matrix`, `runtime_utf8_budget`, `runtime_terminal_exit_frame_race` | Deterministic bounded-stream coverage; operational OOM risk remains unmeasured. |
| R04 | Implemented/tested | `mixed_ingress_serializes_complete_turns`, `queue_failure_and_cancel_release`, `remediation_end_to_end_restart_scenario` | Full PostgreSQL restart execution remains gated. |
| R05 | Implemented/tested | `exchange_shaping_protocol_matrix`, `context_unfittable_has_zero_provider_calls` | Provider loopback/heuristic admission evidence; no live API rejection reproduced. |
| R06 | Implemented/tested | `custom_metadata_rejection_matrix`, `invalid_persisted_tool_quarantine`, `generated_script_parse_matrix`, `custom_tool_commit_ack_reconciliation` | Receipt suite's PostgreSQL leg remains gated. |
| R07 | Implemented/tested | `agent_checkpoint_real_trigger_matrix`, `loop_halt_checkpoint_message_ids_are_durable`, `resume_counter_and_interval_continuity` | Durable restart scenarios are not operational deployment evidence. |
| R08 | Implemented/tested | `agent_checkpoint_real_trigger_matrix`, `resume_counter_and_interval_continuity`, `interval_save_failure_does_not_fail_turn` | Interval behavior tested with injected/in-memory persistence. |
| R09 | Implemented/tested | `live_write_checkpoint_restore_compatibility`, `checkpoint_version_and_missing_source_matrix`, `restore_failure_has_no_partial_state` | PostgreSQL restore execution remains gated; pre-change deleted IDs remain unrecoverable. |
| R10 | Implemented/tested | `tool_outcome_database_roundtrip_and_legacy_outcome_no_substring_inference`, `registry_failures_reach_next_model_request` | Deterministic persistence/reload evidence; legacy rows retain unknown status. |
| R11 | Implemented/tested | `compaction_write_failure_reload_matrix`, `compaction_commit_ack_reconciliation`, `compaction_stale_revision` | PostgreSQL fault-injection and lost-ack execution remains gated. |
| R12 | Implemented/tested | `recursive_replacement_failure_retains_sources`, `two_cycle_durable_history_carries_prior_clip_and_supersedes_lineage` | Fake durable boundary passed; no production failure was reproduced. |
| R13 | Implemented/tested | `summary_empty_output_matrix_initial_recursive` | Initial and recursive empty/non-text paths are covered; live provider behavior remains opt-in. |
| R14 | Implemented/tested | `breaker_open_half_open_recovery`, `breaker_permanent_fault_requires_reset`, `L-c serialized recovery action is seam-only and model-free` | Trusted recovery path is tested; operator recovery has not been exercised in production. |
| R15 | Implemented/tested | `agent_actual_context_pressure_matrix`, `compaction_intent_survives_restart_and_is_consumed_once`, `cache_state_publishes_only_after_commit` | Admission uses heuristic estimates; exact provider tokenization remains unverified. |
| R16 | Implemented/tested | `summary_causal_order_and_span`, `continuation_preserves_objective_and_tool_status` | Structured projection tested with deterministic inputs; summary factual quality is unverified. |
| R17 | Implemented/tested | `summary_fit_matrix_initial_recursive`, `summary_fit_matrix_single_cycle_gate`, `compaction_deadline_cancel_retry_matrix` | Fake-clock/loopback fit and deadline evidence; no live provider capacity reproduction. |
| P2 | Implemented/tested | `mcp_discovery_bound_matrix`, `mcp_generation_collision_atomicity`, `mcp_nested_schema_and_result_semantics`, `startup_skips_failed_server_continues_next`, `provider_wire_contract_matrix`, `provider_terminal_usage_matrix`, `provider_lifetime_cancellation_matrix`, `usage_accounting_no_double_count` | MCP/provider loopback and installed-SDK checks passed; live remote-server/provider behavior remains unverified. |

“Implemented/tested” means the named regression passed in the accepted implementation record. It does not mean the original incident occurred, that every database-gated scenario ran, or that deployment and operational effects are known. The retention policy is deliberate: original transcripts and referenced archives are retained indefinitely in this remediation; no transcript garbage collection is implemented.

## Documentation follow-through

The root `AGENTS.md` provides concise working guidance and links here for review caveats. Existing root/domain `CLAUDE.md` files remain useful navigation, but several promises—unconditional compaction rollback safety, complete output limits, and interval checkpointing—are contradicted by the inspected code. Treat them as intended contracts until repaired and verified. Update affected domain guidance when fixes land; do not mark this report's findings resolved without implementation and regression evidence.
