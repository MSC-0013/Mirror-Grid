-- 004_reliability.sql: Fault specifications, active faults, and circuit breaker tracking

-- 1. Fault specifications (reusable fault definitions)
CREATE TABLE IF NOT EXISTS fault_specifications (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    fault_type TEXT NOT NULL,
    target_service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id TEXT REFERENCES service_dependencies(id) ON DELETE CASCADE,
    parameters TEXT NOT NULL DEFAULT '{}',
    safety_rules TEXT NOT NULL DEFAULT '{"maxDurationMicros": 300000000, "autoAbortOnBurnRate": true}',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CONSTRAINT chk_fault_target CHECK (
        (target_service_id IS NOT NULL AND target_edge_id IS NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NOT NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_fault_spec_world ON fault_specifications(world_id);
CREATE INDEX IF NOT EXISTS idx_fault_spec_target_svc ON fault_specifications(target_service_id);
CREATE INDEX IF NOT EXISTS idx_fault_spec_target_edge ON fault_specifications(target_edge_id);

-- 2. Experiment fault executions (scheduled or active fault instances)
CREATE TABLE IF NOT EXISTS experiment_faults (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_id TEXT,
    fault_spec_id TEXT NOT NULL REFERENCES fault_specifications(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'SCHEDULED',
    scheduled_start_micros BLOB NOT NULL,
    scheduled_duration_micros BLOB NOT NULL,
    actual_start_micros BLOB,
    actual_end_micros BLOB,
    abort_reason TEXT,
    applied_parameters TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_faults_world_status ON experiment_faults(world_id, status);
CREATE INDEX IF NOT EXISTS idx_exp_faults_timing ON experiment_faults(scheduled_start_micros, scheduled_duration_micros);

-- 3. Circuit breaker state snapshots (for control plane & UI inspection)
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id TEXT REFERENCES service_dependencies(id) ON DELETE CASCADE,
    current_state TEXT NOT NULL DEFAULT 'CLOSED',
    state_entered_at_micros BLOB NOT NULL DEFAULT 0,
    failure_rate_ppm INTEGER NOT NULL DEFAULT 0,
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    total_requests BLOB NOT NULL DEFAULT 0,
    total_rejections BLOB NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    CONSTRAINT uq_breaker_world_service_edge UNIQUE (world_id, service_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_cb_states_lookup ON circuit_breaker_states(world_id, current_state);

-- 4. Circuit breaker transition log (audit history of state changes)
CREATE TABLE IF NOT EXISTS circuit_breaker_transitions (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id TEXT REFERENCES service_dependencies(id) ON DELETE CASCADE,
    from_state TEXT NOT NULL,
    to_state TEXT NOT NULL,
    transition_reason TEXT NOT NULL,
    event_micros BLOB NOT NULL,
    failure_rate_ppm INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cb_transitions_timeline ON circuit_breaker_transitions(world_id, event_micros DESC);
