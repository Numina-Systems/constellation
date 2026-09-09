# Integrity and lifecycle remediation operator guide

Date: 2026-09-09

This guide describes the behavior implemented by the integrity and lifecycle remediation. It is an operational reference, not evidence that a past incident was reproduced or that production has been migrated. Do not apply migrations, start the daemon, or point tests at an operational database without a separate approval.

## What changed

### Retained transcript and active history

Constellation keeps canonical rows in the existing `messages` table. Compaction changes the active projection, not the retained transcript. The active projection is revisioned and ordered by conversation membership.

- `readActive(conversationId)` returns the messages currently used for context and its monotonic revision.
- `readHistorical(conversationId, limit)` reads retained rows and labels each row `historical` when active or `superseded` when no longer active.
- `readByIds` reads retained originals in the caller's explicit order and requires every ID to belong to the conversation.
- Compaction archives source material and publishes a summary through one history-store operation. Recursive replacement retains source archives and records supersession provenance.
- Checkpoint count pruning deletes old checkpoint rows only. It does not delete transcript rows or referenced archive bytes.

There is no transcript garbage collection in this remediation. Original message and archive retention grows with use and therefore requires disk-capacity monitoring and a future, separately designed retention policy. Rows already deleted before this change cannot be recovered.

### Checkpoints and restore

New checkpoints use version **2** (`CHECKPOINT_VERSION = 2`). They include ordered active message IDs, transcript revision, active archive IDs, and provenance references.

Version 1 checkpoints are decoded and migrated to the v2 shape. The migration marks `migratedFromVersion: 1`, sets the revision to `0`, and leaves archive/provenance arrays empty. This is a compatibility path, not a reconstruction of provenance that was never stored. A separately configured historical restore reports that provenance gap rather than selecting future archives silently.

Unknown versions fail validation. Native v2 restore validates retained message IDs before mutation. A missing v2 message ID fails explicitly and non-destructively. Legacy v1 missing IDs are reported as unavailable legacy provenance; this does not promise recovery of deleted rows.

Automatic resume and explicit restore are different operations:

- `auto_resume` reads the latest durable active projection and preserves commits made after an older checkpoint. It does not rewind membership or replay old working-memory state.
- Explicit checkpoint restore replaces active membership in the requested order, advances the conversation revision, and restores working memory only after durable success. Later messages remain retained but inactive.
- An unfinished tool batch or unresolved effect marks the conversation recovery-required. Startup refuses provider and handler execution for that conversation; trusted recovery appends typed `outcome_unknown` results for crash-orphaned assistant tool calls and repairs every unfinished batch before execution resumes. It never replays handlers automatically.

### Protected memory deletion

The public memory-delete path is owner-scoped and rechecks the authoritative row under a lock before writing an audit event or deleting. It rejects missing/foreign IDs without disclosing foreign metadata. It also rejects `readonly`, `familiar`, `append`, pinned, and core blocks. Only an owner-owned, unpinned, non-core `readwrite` block can be deleted through the public path.

History-owned archive blocks are additionally protected by persistence constraints. They are readonly, pinned, and marked `history_owned`; public memory operations and ingest/archivist maintenance cannot overwrite, move, or delete them. Compaction history commits are the dedicated path for creating archive artifacts and changing active selection.

A rejected deletion has no event. An accepted deletion writes its event and delete in the same transaction. A transaction failure does not publish a partial deletion.

## Runtime limits and unknown effects

The Deno runtime applies byte limits before decoding or concatenating stream data. Defaults are:

| Setting | Default | Scope |
|---|---:|---|
| `agent.max_code_size` | `51200` bytes | Generated code input. |
| `agent.max_output_size` | `1048576` bytes | Decoded user output from `__output__`. |
| `agent.code_timeout` | `60000` ms | Execution timeout. |
| `agent.max_tool_calls_per_exec` | `25` | Tool calls per execution. |
| `runtime.max_stdout_bytes` | `4194304` bytes | Raw stdout, including protocol traffic. |
| `runtime.max_stderr_bytes` | `65536` bytes | Raw stderr. |
| `runtime.max_ipc_frame_bytes` | `1048576` bytes | One newline-delimited IPC frame, including an unterminated frame. |

The host also bounds diagnostic text to 2,000 bytes and cleanup waiting to 100 ms. A stream, frame, protocol, timeout, or cancellation violation closes admission synchronously. A queued call cannot begin after closure. Already-started host handlers may be uncancellable: their IDs are reported as `outcome_unknown`; the runtime does not claim rollback and does not retry them automatically.

`unrestricted = true` removes Deno permission allowlists. It does not remove the host-side size, lifetime, or call-count limits, and the process-isolation boundary is the remaining sandbox boundary.

## Request budgets and model windows

Provider admission estimates the serialized provider-shaped request, including system text, diary, recall, skills, snapshots, messages, tool schemas, output reserve, and safety margin. The estimate uses the documented heuristic of roughly four characters per token and is not a tokenizer guarantee.

The default safety margin is `max(256, ceil(context_window * 0.02))`. A request whose mandatory context plus output reserve and margin cannot fit returns typed `context_unfittable` without a knowingly oversized provider call.

Inference and summarization have separate windows:

- Set `[model].context_window` when the provider capability is known.
- Set `[summarization].context_window` when summarization uses a separately configured model. Without it, compaction stops with a configuration-required diagnostic; it does not guess the inference window.
- An identical summarizer may inherit the effective inference window.
- If no explicit model window exists, `agent.max_context_tokens` is used with a warning that it is operator-configured, not verified provider capability.
- `max_chunk_tokens` is a soft summary payload cap. It is not a replacement for a context window.

Validate output reserve plus safety margin against the selected window before enabling a provider. Provider-reported usage is separate from local estimates; do not treat a heuristic fit as proof of provider tokenizer fit.

## Tool outcomes and failure handling

Tool results use a typed `ToolOutcome`:

- `success` carries output, including output that happens to contain the word “error”.
- `error` carries a stable safe code and explanatory message.
- `cancelled` carries `cancelled` or `deadline_exceeded`.
- `outcome_unknown` means an effect may have started but its final state is not known.

Outcomes are persisted with their correlated tool call and survive reload. Legacy tool rows without typed outcome decode as `legacy_unknown`; their original content is retained and no substring heuristic classifies them as errors. The agent rejects integrity failures with typed `AgentError` code `INTEGRITY_FAILED`. Unresolved call IDs are recorded before future provider work; persistence failure latches the conversation recovery-required.

A provider or capacity failure is a failed turn, not permission to replay effects. Independent ingress can proceed after the turn slot is released unless that conversation is recovery-required.

## Compaction breaker and trusted recovery

Compaction uses a `CLOSED` / `OPEN` / `HALF_OPEN` breaker. The default transient threshold is 3 failures and the default cooldown is 60,000 ms. After cooldown, exactly one half-open probe is admitted. A successful probe closes the breaker. Unfittable requests do not count as transient failures. Stale membership, ambiguous history state, storage, protocol, authentication, and other intervention faults require trusted recovery rather than blind retries.

The operator-only recovery seam is serialized with the agent and accepts:

```text
/compaction status
/compaction reset
```

`status` reports breaker state, failure count, and whether intervention is required. `reset` clears the breaker. These commands are not model-accessible tools and do not grant unrestricted reset access. Reset only after checking the underlying provider/configuration/storage condition; it cannot establish truth after an unknown database commit. Reload trusted history or restart the affected conversation when the result is `history_state_unknown` or recovery-required.

## MCP discovery controls

Each MCP tool/prompt list operation has one absolute deadline and page budget. Defaults are 30,000 ms total and 64 pages. Discovery stops on caller cancellation, deadline expiry, page cap, or repeated cursor. A failed or stale attempt publishes no partial generation; the previous generation remains usable. Normalized-name collisions and duplicate original names fail before publication. Failed startup clients are disconnected and later configured servers continue with a visible failure summary.

Full valid input schemas are retained. Flat parameters are only a model/stub projection. Nested objects, arrays, unions, and enums are validated through the retained schema path; unsupported schema keywords are rejected with a bounded path diagnostic instead of being coerced. MCP result-level `isError`, structured content, and bounded descriptors for text, image/audio, resource, and resource-link content are preserved. Transport errors remain distinct from result errors.

## Safe verification commands

Use the unit command for the default local check:

```sh
bun run build
bun run test:unit
```

`bun run build` runs `tsc --noEmit`; it does not bundle the daemon and does not check `src/runtime/deno/**`. Run Deno checks separately when runtime bridge code changes:

```sh
deno check src/runtime/deno/runtime.ts
```

Database-backed commands require an explicit disposable PostgreSQL/pgvector admin endpoint:

```sh
bun run test:integration-required
bun run test:legacy-isolated
bun run test:full-isolated
```

Set `TEST_DATABASE_ADMIN_URL` to a local/disposable admin endpoint before these commands. The harness creates a random `constellation_test_<uuid>` database, applies migrations there, and drops only that database. It rejects unsafe targets and never falls back to `DATABASE_URL`. If the variable is absent, the integration-required command must fail visibly; do not substitute the daemon database. Each concurrent suite needs its own harness database.

Live provider/API tests are opt-in and are not required for deterministic adapter tests. The full `bun test` command includes suites outside the isolated migration boundary and may contact or mutate a database; inspect the suite before running it. The Phase 0 testing note lists current legacy-isolated remainders. No test command should source local secret-bearing configuration.

## Operational limits and rollout caveats

This change has not deployed migrations or exercised a production database. PostgreSQL transaction-fault, restart, archive-protection, and receipt-reconciliation scenarios are wired as required integration gates, but the recorded Phase 6 evidence remains blocked when `TEST_DATABASE_ADMIN_URL` is absent. Deterministic fake, in-memory, loopback, and source-level checks do not prove production connectivity, provider behavior, disk capacity, or the root cause of a historical incident.

Monitor retained `messages`, history-owned archive bytes, checkpoints, and disk growth. Plan any future garbage collection as a separate design with explicit checkpoint/provenance compatibility and operator approval.
