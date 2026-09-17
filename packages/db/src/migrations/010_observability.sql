-- 010_observability.sql: Distributed trace spans and time-series metrics snapshots

-- 1. Distributed Trace Spans table
CREATE TABLE IF NOT EXISTS trace_spans (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    trace_id           VARCHAR(36) NOT NULL,
    span_id            VARCHAR(36) NOT NULL,
    parent_span_id     VARCHAR(36),
    service_id         VARCHAR(36) REFERENCES services(id) ON DELETE SET NULL,
    service_name       VARCHAR(255) NOT NULL,
    operation_name     VARCHAR(255) NOT NULL,
    span_kind          VARCHAR(255) NOT NULL DEFAULT 'INTERNAL' CHECK (span_kind IN ('SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL')),
    start_time_micros  INT NOT NULL,
    duration_micros    INT NOT NULL,
    status_code        VARCHAR(255) NOT NULL DEFAULT 'OK' CHECK (status_code IN ('OK', 'ERROR', 'UNSET')),
    status_message     TEXT,
    attributes         JSON NOT NULL DEFAULT ('{}'),
    events             JSON NOT NULL DEFAULT ('[]'),
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_spans_trace ON trace_spans(trace_id, start_time_micros ASC);
CREATE INDEX idx_spans_world_time ON trace_spans(world_id, start_time_micros DESC);
CREATE INDEX idx_spans_service ON trace_spans(service_name, start_time_micros DESC);
-- MySQL has no partial indexes. A STORED generated column reproduces the
-- PostgreSQL `WHERE status_code = 'ERROR'` predicate as an indexable value.
ALTER TABLE trace_spans
  ADD COLUMN is_error TINYINT(1) AS (status_code = 'ERROR') STORED;
CREATE INDEX idx_spans_error ON trace_spans (world_id, is_error);

-- 2. Aggregated Metrics Snapshots
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id         VARCHAR(36) REFERENCES services(id) ON DELETE CASCADE,
    metric_timestamp   DATETIME(3) NOT NULL,
    metric_name        VARCHAR(255) NOT NULL,
    labels             JSON NOT NULL DEFAULT ('{}'),
    value_count        INT NOT NULL,
    value_sum          DOUBLE NOT NULL,
    p50_ms             DOUBLE,
    p95_ms             DOUBLE,
    p99_ms             DOUBLE,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_metrics_query ON metrics_snapshots(world_id, service_id, metric_name, metric_timestamp DESC);
