-- 010_observability.sql: Distributed trace spans and time-series metrics snapshots

-- 1. Distributed Trace Spans table
CREATE TABLE IF NOT EXISTS trace_spans (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    trace_id TEXT NOT NULL,
    span_id TEXT NOT NULL,
    parent_span_id TEXT,
    service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
    service_name TEXT NOT NULL,
    operation_name TEXT NOT NULL,
    span_kind TEXT NOT NULL DEFAULT 'INTERNAL' CHECK (span_kind IN ('SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER', 'INTERNAL')),
    start_time_micros INTEGER NOT NULL,
    duration_micros INTEGER NOT NULL,
    status_code TEXT NOT NULL DEFAULT 'OK' CHECK (status_code IN ('OK', 'ERROR', 'UNSET')),
    status_message TEXT,
    attributes TEXT NOT NULL DEFAULT '{}',
    events TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_spans_trace ON trace_spans(trace_id, start_time_micros ASC);
CREATE INDEX IF NOT EXISTS idx_spans_world_time ON trace_spans(world_id, start_time_micros DESC);
CREATE INDEX IF NOT EXISTS idx_spans_service ON trace_spans(service_name, start_time_micros DESC);
CREATE INDEX IF NOT EXISTS idx_spans_error ON trace_spans(world_id, status_code) WHERE status_code = 'ERROR';

-- 2. Aggregated Metrics Snapshots
CREATE TABLE IF NOT EXISTS metrics_snapshots (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
    metric_timestamp INTEGER NOT NULL,
    metric_name TEXT NOT NULL,
    labels TEXT NOT NULL DEFAULT '{}',
    value_count INTEGER NOT NULL,
    value_sum REAL NOT NULL,
    p50_ms REAL,
    p95_ms REAL,
    p99_ms REAL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_query ON metrics_snapshots(world_id, service_id, metric_name, metric_timestamp DESC);
