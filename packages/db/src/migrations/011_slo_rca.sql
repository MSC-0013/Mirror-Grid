-- 011_slo_rca.sql: Service Level Objectives, Error Budgets, and Automated RCA (MySQL 8.4)

-- 1. Service Level Objectives table
CREATE TABLE IF NOT EXISTS service_slos (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    sli_type           VARCHAR(255) NOT NULL CHECK (sli_type IN ('AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95')),
    target_percentage  DOUBLE NOT NULL,
    window_seconds     INT NOT NULL DEFAULT 2592000,
    threshold_latency_micros INT,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL,
    CONSTRAINT uq_service_slo_name UNIQUE (service_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_slos_world ON service_slos(world_id);

-- 2. SLO Burn Events and Alert Triggers
CREATE TABLE IF NOT EXISTS slo_burn_events (
    id                 VARCHAR(36) PRIMARY KEY,
    slo_id             VARCHAR(36) NOT NULL REFERENCES service_slos(id) ON DELETE CASCADE,
    burn_rate          DOUBLE NOT NULL,
    severity           VARCHAR(255) NOT NULL CHECK (severity IN ('P1_CRITICAL', 'P2_HIGH', 'P3_WARNING')),
    long_window_seconds INT NOT NULL,
    short_window_seconds INT NOT NULL,
    budget_consumed_percent DOUBLE NOT NULL,
    triggered_at       DATETIME(3) NOT NULL,
    resolved_at        DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_burn_events_slo ON slo_burn_events(slo_id, triggered_at DESC);

-- 3. Automated RCA Investigations
CREATE TABLE IF NOT EXISTS rca_investigations (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id  VARCHAR(36),
    root_cause_service_id VARCHAR(36) REFERENCES services(id) ON DELETE SET NULL,
    confidence_percentage DOUBLE NOT NULL,
    failure_type       VARCHAR(255) NOT NULL CHECK (failure_type IN ('LATENCY_INDUCED_SATURATION', 'RESOURCE_STARVATION', 'POISON_PILL', 'CIRCUIT_TRIP_CASCADE')),
    causal_chain       TEXT NOT NULL DEFAULT '[]',
    evidence_summary   TEXT NOT NULL DEFAULT '{}',
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_rca_world ON rca_investigations(world_id, created_at DESC);

-- 4. Executive Reliability Reports
CREATE TABLE IF NOT EXISTS reliability_reports (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title              VARCHAR(255) NOT NULL,
    time_range_start   INT NOT NULL,
    time_range_end     INT NOT NULL,
    overall_score      DOUBLE NOT NULL,
    error_budget_consumed_percent DOUBLE NOT NULL,
    report_markdown    TEXT NOT NULL,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_reports_world ON reliability_reports(world_id, created_at DESC);
