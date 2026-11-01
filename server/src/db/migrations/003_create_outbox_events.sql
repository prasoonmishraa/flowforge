CREATE TABLE outbox_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

    event_type VARCHAR(100) NOT NULL
        CHECK (BTRIM(event_type) <> ''),

    aggregate_id BIGINT NOT NULL
        REFERENCES executions(id) ON DELETE RESTRICT,

    payload JSONB NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    published_at TIMESTAMPTZ,

    attempts INTEGER NOT NULL DEFAULT 0
        CHECK (attempts >= 0),

    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    lock_token UUID,

    locked_until TIMESTAMPTZ,

    last_error TEXT,

    CONSTRAINT outbox_lock_fields_check
        CHECK (
            (lock_token IS NULL AND locked_until IS NULL)
            OR
            (lock_token IS NOT NULL AND locked_until IS NOT NULL)
        ),

    CONSTRAINT outbox_published_unlocked_check
        CHECK (
            published_at IS NULL
            OR (lock_token IS NULL AND locked_until IS NULL)
        )
);

CREATE INDEX idx_outbox_events_pending
ON outbox_events (next_attempt_at, created_at)
WHERE published_at IS NULL;
