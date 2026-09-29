# Bluesky ambient context (issue #15)

Date: 2026-09-29
Status: implemented
Issue: Numina-Systems/constellation#15

## Problem

Posts (incoming and the agent's own) existed only as conversation messages. After
compaction they vanished from context, so the agent lost ambient awareness of
recent Bluesky activity.

## Solution

Persist observed posts in a new `bluesky_events` table and surface the newest
ones as a dynamic context-provider section (`bluesky-activity`) in every turn's
snapshot attachment. The section is independent of event processing and
unaffected by conversation compaction.

- Migration: `src/persistence/migrations/019_bluesky_events.sql` (append-only,
  repeat-safe). `uri` is the primary key; idempotent ingestion via
  `ON CONFLICT (uri) DO NOTHING` absorbs Jetstream redelivery after reconnect.
- Port: `BlueskyEventStore` in `src/extensions/bluesky/types.ts`; adapter
  `createPostgresBlueskyEventStore` (`postgres-event-store.ts`) over
  `PersistenceProvider`, parameterized SQL, single statements.
- Recording: the exported `handleCommitEvent` seam in `source.ts` owns the
  per-event accept/record/dispatch decision. Recording is fire-and-forget —
  a slow or failing store never stalls the subscription loop or blocks dispatch.
- Provider: `createBlueskyContextProvider` (`context-provider.ts`) — 60 s TTL
  cache, single-flight refresh, stale-cache-on-error (mirrors the activity
  provider). Output has no `##` header; the snapshot pipeline composes the
  `## bluesky-activity` section.

## Operator decisions (2026-09-29)

1. **Ordering:** recency, newest first. No engagement weighting — like/reply
   counts are not in the Jetstream stream and fetching them is out of scope.
2. **Own posts:** capture outbound posts; the agent's own posts appear in the
   section. Mechanism: record-only path in the Jetstream loop (not a sandbox
   IPC hook).
3. **Handles:** resolve `did → handle` via the authenticated `BskyAgent`
   (`app.bsky.actor.getProfiles`, chunked ≤ 25 actors), cached per refresh
   window; fall back to a truncated DID (first 12 / last 4 chars) on failure.
4. **Retention:** default 30 days, configurable via `bluesky.context_retention_days`.

Two of the issue's open questions resolve from the existing architecture: there
is no separate "Bluesky agent" — inner conversations (subconscious/archivist)
receive their own fixed dynamic-provider subsets, so the main agent is the only
injection target. The section is a plain formatted list, consistent with every
existing provider; no LLM summarization.

## Own posts: record-only, no dispatch

An own post (`event.did === agentDid`, create operation only) is recorded to the
store but **not dispatched** — unless the agent's DID is explicitly in
`watched_dids`, in which case existing dispatch semantics are preserved.

**Deliberate behavior change:** today an own post replying to the agent's own
post is accepted via the reply rule (`parent URI starts with at://<agentDid>/`)
and dispatched, creating a self-triggered conversation loop. Under the new rule
it is record-only. This loop prevention is intended.

Non-create (delete/update) own-post commits are ignored entirely: no record, no
dispatch, no throw. Delete commits carry no `commit.record` and building a
message from one would throw inside the subscription loop's IIFE, whose catch
logs and exits without reconnecting — permanently killing ingestion.

## Config

`[bluesky]` section additions (defaults in parentheses):
- `context_enabled` (true) — provider toggle; only meaningful when `bluesky.enabled`.
- `context_limit` (10, range 1–50) — number of newest posts in the section.
- `context_retention_days` (30, range 1–3650) — rows older than this are pruned
  once per provider refresh.

## Known limits and future work

- **Jetstream gaps can miss own posts** — the record-only path depends on the
  live stream. Accepted for ambient context; redeliveries are idempotent.
  Future: reconcile via `app.bsky.feed.getAuthorFeed` during provider refresh.
- **Handle resolution depends on the PDS/session**; falls back to truncated
  DIDs. One `getProfiles` batch per ≤ 60 s window is negligible against rate
  limits.
- **Composition-root wiring has no automated harness** (`src/index.ts` has no
  wiring-test convention); it is verified by type-checking plus the manual smoke
  check documented in the PR.
- **Concurrent writes:** single daemon process per owner is the existing
  activity-module invariant; the same assumption applies here.
