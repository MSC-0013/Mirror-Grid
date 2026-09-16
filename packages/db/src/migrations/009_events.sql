-- 009_events.sql: Transactional Outbox, idempotent consumer tracking, CQRS activity feed, and event store

-- 1. Transactional Outbox table
CREATE TABLE IF NOT EXISTS outbox_events (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    aggregate_type TEXT NOT NULL,
    aggregate_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    partition_key TEXT NOT NULL,
    sequence_num INTEGER NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    headers TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL,
    published_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_events(created_at ASC)
    WHERE published_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_world_seq ON outbox_events(world_id, sequence_num ASC);

-- 2. Idempotent Consumer deduplication ledger
CREATE TABLE IF NOT EXISTS consumed_events (
    event_id TEXT NOT NULL,
    consumer_group TEXT NOT NULL,
    processed_at INTEGER NOT NULL,
    PRIMARY KEY (event_id, consumer_group)
);

CREATE INDEX IF NOT EXISTS idx_consumed_events_date ON consumed_events(processed_at);

-- 3. CQRS World Activity Feed (Denormalized read projection)
CREATE TABLE IF NOT EXISTS world_activity_feed (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    actor_email TEXT,
    severity TEXT NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    summary TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    occurred_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_activity_feed_world ON world_activity_feed(world_id, occurred_at DESC);

-- 4. Event Store Journal & Projection Checkpoints
CREATE TABLE IF NOT EXISTS event_store (
    seq_num INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    stream_id TEXT NOT NULL,
    stream_version INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    metadata TEXT NOT NULL DEFAULT '{}',
    occurred_at INTEGER NOT NULL,
    UNIQUE(stream_id, stream_version)
);

CREATE INDEX IF NOT EXISTS idx_event_store_stream ON event_store(stream_id, stream_version ASC);

CREATE TABLE IF NOT EXISTS projection_checkpoints (
    projection_name TEXT PRIMARY KEY,
    last_processed_seq INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
);
