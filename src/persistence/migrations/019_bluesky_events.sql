-- Ambient Bluesky context (issue #15): append-only store of posts observed on
-- the Jetstream stream, both incoming accepted events and the agent's own
-- posts. Rows feed the bluesky-activity context provider and are pruned by
-- the configured retention window. This migration is additive and
-- repeat-safe; existing rows are untouched.
--
-- Idempotency is owner-scoped: the primary key is (owner, uri) so Jetstream
-- redeliveries are absorbed per owner without one owner's ingest swallowing
-- another owner's record of the same post.
CREATE TABLE IF NOT EXISTS bluesky_events (
    uri TEXT NOT NULL,
    owner TEXT NOT NULL,
    author_did TEXT NOT NULL,
    content TEXT NOT NULL,
    reply_parent_uri TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    indexed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (owner, uri)
);
CREATE INDEX IF NOT EXISTS idx_bluesky_events_owner_created
    ON bluesky_events (owner, created_at DESC, indexed_at DESC);
