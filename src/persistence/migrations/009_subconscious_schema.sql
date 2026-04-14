-- Interest registry schema for the subconscious module

-- Interests table: tracks agent interests and curiosities
CREATE TABLE IF NOT EXISTS interests (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'emergent' CHECK (source IN ('emergent', 'seeded', 'external')),
    engagement_score DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dormant', 'abandoned')),
    last_engaged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_interests_owner ON interests (owner);
CREATE INDEX IF NOT EXISTS idx_interests_owner_status ON interests (owner, status);
CREATE INDEX IF NOT EXISTS idx_interests_engagement_score ON interests (engagement_score);

-- Curiosity threads table: tracks questions being explored within an interest
CREATE TABLE IF NOT EXISTS curiosity_threads (
    id TEXT PRIMARY KEY,
    interest_id TEXT NOT NULL REFERENCES interests(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    question TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'exploring', 'resolved', 'parked')),
    resolution TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_curiosity_threads_interest_id ON curiosity_threads (interest_id);
CREATE INDEX IF NOT EXISTS idx_curiosity_threads_owner ON curiosity_threads (owner);
CREATE INDEX IF NOT EXISTS idx_curiosity_threads_status ON curiosity_threads (status);

-- Exploration log table: records exploration actions and outcomes
CREATE TABLE IF NOT EXISTS exploration_log (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    interest_id TEXT REFERENCES interests(id) ON DELETE SET NULL,
    curiosity_thread_id TEXT REFERENCES curiosity_threads(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    tools_used JSONB NOT NULL DEFAULT '[]',
    outcome TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exploration_log_owner ON exploration_log (owner);
CREATE INDEX IF NOT EXISTS idx_exploration_log_created_at ON exploration_log (created_at);
