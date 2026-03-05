-- Activity state tracking
CREATE TABLE IF NOT EXISTS activity_state (
    owner TEXT PRIMARY KEY,
    mode TEXT NOT NULL DEFAULT 'active' CHECK (mode IN ('active', 'sleeping')),
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_transition_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Event queue for deferred events during sleep
CREATE TABLE IF NOT EXISTS event_queue (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    source TEXT NOT NULL,
    payload JSONB NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high')),
    flagged BOOLEAN NOT NULL DEFAULT FALSE,
    enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_event_queue_owner_priority ON event_queue (owner, priority, enqueued_at)
    WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_event_queue_owner_flagged ON event_queue (owner, flagged)
    WHERE processed_at IS NULL AND flagged = TRUE;
