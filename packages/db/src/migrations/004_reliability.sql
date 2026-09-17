-- 004_reliability.sql: Fault specifications, active faults, and circuit breaker tracking

-- 1. Fault specifications (reusable fault definitions)
CREATE TABLE IF NOT EXISTS fault_specifications (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    description        TEXT,
    fault_type         VARCHAR(255) NOT NULL,
    target_service_id  VARCHAR(36) REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id     VARCHAR(36) REFERENCES service_dependencies(id) ON DELETE CASCADE,
    parameters         VARCHAR(255) NOT NULL DEFAULT '{}',
    safety_rules       VARCHAR(255) NOT NULL DEFAULT '{"maxDurationMicros": 300000000, "autoAbortOnBurnRate": true}',
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL,
    CONSTRAINT chk_fault_target CHECK (
        (target_service_id IS NOT NULL AND target_edge_id IS NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NOT NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NULL)
    )
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_fault_spec_world ON fault_specifications(world_id);
CREATE INDEX idx_fault_spec_target_svc ON fault_specifications(target_service_id);
CREATE INDEX idx_fault_spec_target_edge ON fault_specifications(target_edge_id);

-- 2. Experiment fault executions (scheduled or active fault instances)
CREATE TABLE IF NOT EXISTS experiment_faults (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_id      VARCHAR(36),
    fault_spec_id      VARCHAR(36) NOT NULL REFERENCES fault_specifications(id) ON DELETE CASCADE,
    status             VARCHAR(255) NOT NULL DEFAULT 'SCHEDULED',
    scheduled_start_micros BIGINT UNSIGNED NOT NULL,
    scheduled_duration_micros BIGINT UNSIGNED NOT NULL,
    actual_start_micros BIGINT UNSIGNED,
    actual_end_micros  BIGINT UNSIGNED,
    abort_reason       TEXT,
    applied_parameters VARCHAR(255) NOT NULL,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_exp_faults_world_status ON experiment_faults(world_id, status);
CREATE INDEX idx_exp_faults_timing ON experiment_faults(scheduled_start_micros, scheduled_duration_micros);

-- 3. Circuit breaker state snapshots (for control plane & UI inspection)
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id            VARCHAR(36) REFERENCES service_dependencies(id) ON DELETE CASCADE,
    current_state      VARCHAR(255) NOT NULL DEFAULT 'CLOSED',
    state_entered_at_micros BIGINT UNSIGNED NOT NULL DEFAULT 0,
    failure_rate_ppm   INT NOT NULL DEFAULT 0,
    consecutive_failures INT NOT NULL DEFAULT 0,
    consecutive_successes INT NOT NULL DEFAULT 0,
    total_requests     BIGINT UNSIGNED NOT NULL DEFAULT 0,
    total_rejections   BIGINT UNSIGNED NOT NULL DEFAULT 0,
    updated_at         DATETIME(3) NOT NULL,
    CONSTRAINT uq_breaker_world_service_edge UNIQUE (world_id, service_id, edge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_cb_states_lookup ON circuit_breaker_states(world_id, current_state);

-- 4. Circuit breaker transition log (audit history of state changes)
CREATE TABLE IF NOT EXISTS circuit_breaker_transitions (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id            VARCHAR(36) REFERENCES service_dependencies(id) ON DELETE CASCADE,
    from_state         VARCHAR(255) NOT NULL,
    to_state           VARCHAR(255) NOT NULL,
    transition_reason  TEXT NOT NULL,
    event_micros       BIGINT UNSIGNED NOT NULL,
    failure_rate_ppm   INT,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_cb_transitions_timeline ON circuit_breaker_transitions(world_id, event_micros DESC);
