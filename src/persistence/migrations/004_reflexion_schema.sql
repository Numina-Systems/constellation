-- Predictions table (prediction journal)
CREATE TABLE predictions (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    prediction_text TEXT NOT NULL,
    domain TEXT,
    confidence DOUBLE PRECISION,
    context_snapshot JSONB NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'evaluated', 'expired')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ
);

CREATE INDEX idx_predictions_owner ON predictions (owner);
CREATE INDEX idx_predictions_owner_status ON predictions (owner, status);
CREATE INDEX idx_predictions_created_at ON predictions (created_at);

-- Prediction evaluations table
CREATE TABLE prediction_evaluations (
    id TEXT PRIMARY KEY,
    prediction_id TEXT NOT NULL REFERENCES predictions(id) ON DELETE CASCADE,
    owner TEXT NOT NULL,
    outcome TEXT NOT NULL,
    accurate BOOLEAN NOT NULL,
    evidence JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prediction_evaluations_prediction_id ON prediction_evaluations (prediction_id);
CREATE INDEX idx_prediction_evaluations_owner ON prediction_evaluations (owner);

-- Operation traces table
CREATE TABLE operation_traces (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    input JSONB NOT NULL DEFAULT '{}',
    output_summary TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER NOT NULL DEFAULT 0,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_operation_traces_owner ON operation_traces (owner);
CREATE INDEX idx_operation_traces_owner_created_at ON operation_traces (owner, created_at);
CREATE INDEX idx_operation_traces_tool_name ON operation_traces (tool_name);

-- Scheduled tasks table
CREATE TABLE scheduled_tasks (
    id TEXT PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    next_run_at TIMESTAMPTZ NOT NULL,
    last_run_at TIMESTAMPTZ,
    cancelled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_scheduled_tasks_owner ON scheduled_tasks (owner);
CREATE INDEX idx_scheduled_tasks_next_run_at ON scheduled_tasks (next_run_at);
CREATE INDEX idx_scheduled_tasks_cancelled ON scheduled_tasks (cancelled);
