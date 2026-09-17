-- 009_events.sql: Transactional Outbox, idempotent consumer tracking, CQRS activity feed, and event store

-- 1. Transactional Outbox table
CREATE TABLE IF NOT EXISTS outbox_events (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    aggregate_type     VARCHAR(255) NOT NULL,
    aggregate_id       VARCHAR(36) NOT NULL,
    event_type         VARCHAR(255) NOT NULL,
    partition_key      VARCHAR(255) NOT NULL,
    sequence_num       INT NOT NULL,
    payload            JSON NOT NULL DEFAULT ('{}'),
    headers            JSON NOT NULL DEFAULT ('{}'),
    created_at         DATETIME(3) NOT NULL,
    published_at       DATETIME(3),
    -- MySQL has no partial indexes. This STORED generated column reproduces the
    -- Postgres `WHERE published_at IS NULL` predicate as an indexable value, so the
    -- publisher's poll query (R3) never scans already-published rows.
    is_unprocessed     TINYINT(1) AS (published_at IS NULL) STORED
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_outbox_unprocessed ON outbox_events(is_unprocessed, created_at ASC);
CREATE INDEX idx_outbox_world_seq ON outbox_events(world_id, sequence_num ASC);

-- 2. Idempotent Consumer deduplication ledger
CREATE TABLE IF NOT EXISTS consumed_events (
    event_id           VARCHAR(36) NOT NULL,
    consumer_group     VARCHAR(255) NOT NULL,
    processed_at       DATETIME(3) NOT NULL,
    PRIMARY KEY (event_id, consumer_group)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_consumed_events_date ON consumed_events(processed_at);

-- 3. CQRS World Activity Feed (Denormalized read projection)
CREATE TABLE IF NOT EXISTS world_activity_feed (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    event_id           VARCHAR(36) NOT NULL,
    event_type         VARCHAR(255) NOT NULL,
    actor_email        VARCHAR(255),
    severity           VARCHAR(255) NOT NULL DEFAULT 'INFO' CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
    summary            TEXT NOT NULL,
    details            JSON NOT NULL DEFAULT ('{}'),
    occurred_at        DATETIME(3) NOT NULL,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_activity_feed_world ON world_activity_feed(world_id, occurred_at DESC);

-- 4. Event Store Journal & Projection Checkpoints
CREATE TABLE IF NOT EXISTS event_store (
    seq_num            BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_id           VARCHAR(36) NOT NULL UNIQUE,
    stream_id          VARCHAR(36) NOT NULL,
    stream_version     INT NOT NULL,
    event_type         VARCHAR(255) NOT NULL,
    payload            JSON NOT NULL,
    metadata           JSON NOT NULL DEFAULT ('{}'),
    occurred_at        DATETIME(3) NOT NULL,
    UNIQUE(stream_id, stream_version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_event_store_stream ON event_store(stream_id, stream_version ASC);

CREATE TABLE IF NOT EXISTS projection_checkpoints (
    projection_name    VARCHAR(255) PRIMARY KEY,
    last_processed_seq INT NOT NULL DEFAULT 0,
    updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
