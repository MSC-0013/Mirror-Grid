-- 011_slo_rca.sql: Service Level Objectives, Error Budgets, and Automated RCA (SQLite WAL mode)

-- 1. Service Level Objectives table
CREATE TABLE IF NOT EXISTS service_slos (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sli_type TEXT NOT NULL CHECK (sli_type IN ('AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95')),
    target_percentage REAL NOT NULL,
    window_seconds INTEGER NOT NULL DEFAULT 2592000,
    threshold_latency_micros INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CONSTRAINT uq_service_slo_name UNIQUE (service_id, name)
);

CREATE INDEX IF NOT EXISTS idx_slos_world ON service_slos(world_id);

-- 2. SLO Burn Events and Alert Triggers
CREATE TABLE IF NOT EXISTS slo_burn_events (
    id TEXT PRIMARY KEY,
    slo_id TEXT NOT NULL REFERENCES service_slos(id) ON DELETE CASCADE,
    burn_rate REAL NOT NULL,
    severity TEXT NOT NULL CHECK (severity IN ('P1_CRITICAL', 'P2_HIGH', 'P3_WARNING')),
    long_window_seconds INTEGER NOT NULL,
    short_window_seconds INTEGER NOT NULL,
    budget_consumed_percent REAL NOT NULL,
    triggered_at INTEGER NOT NULL,
    resolved_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_burn_events_slo ON slo_burn_events(slo_id, triggered_at DESC);

-- 3. Automated RCA Investigations
CREATE TABLE IF NOT EXISTS rca_investigations (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id TEXT,
    root_cause_service_id TEXT REFERENCES services(id) ON DELETE SET NULL,
    confidence_percentage REAL NOT NULL,
    failure_type TEXT NOT NULL CHECK (failure_type IN ('LATENCY_INDUCED_SATURATION', 'RESOURCE_STARVATION', 'POISON_PILL', 'CIRCUIT_TRIP_CASCADE')),
    causal_chain TEXT NOT NULL DEFAULT '[]',
    evidence_summary TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rca_world ON rca_investigations(world_id, created_at DESC);

-- 4. Executive Reliability Reports
CREATE TABLE IF NOT EXISTS reliability_reports (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    time_range_start INTEGER NOT NULL,
    time_range_end INTEGER NOT NULL,
    overall_score REAL NOT NULL,
    error_budget_consumed_percent REAL NOT NULL,
    report_markdown TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_world ON reliability_reports(world_id, created_at DESC);
