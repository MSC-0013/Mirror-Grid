-- 004_reliability.sql: Fault specifications, active faults, and circuit breaker tracking

-- 1. Fault specifications (reusable fault definitions)
CREATE TABLE IF NOT EXISTS fault_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    fault_type VARCHAR(50) NOT NULL, -- LATENCY, ERROR, PACKET_DROP, JITTER, BLACKHOLE, BANDWIDTH_LIMIT, CORRUPT_PAYLOAD, SERVICE_KILL
    target_service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id UUID REFERENCES service_dependencies(id) ON DELETE CASCADE,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    safety_rules JSONB NOT NULL DEFAULT '{"maxDurationMicros": 300000000, "autoAbortOnBurnRate": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_fault_target CHECK (
        (target_service_id IS NOT NULL AND target_edge_id IS NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NOT NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NULL) -- Global world fault
    )
);

CREATE INDEX IF NOT EXISTS idx_fault_spec_world ON fault_specifications(world_id);
CREATE INDEX IF NOT EXISTS idx_fault_spec_target_svc ON fault_specifications(target_service_id) WHERE target_service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fault_spec_target_edge ON fault_specifications(target_edge_id) WHERE target_edge_id IS NOT NULL;

-- 2. Experiment fault executions (scheduled or active fault instances)
CREATE TABLE IF NOT EXISTS experiment_faults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_id UUID, -- Optional foreign key to experiments table (added M05)
    fault_spec_id UUID NOT NULL REFERENCES fault_specifications(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, ACTIVE, COMPLETED, ABORTED, FAILED
    scheduled_start_micros BIGINT NOT NULL,
    scheduled_duration_micros BIGINT NOT NULL,
    actual_start_micros BIGINT,
    actual_end_micros BIGINT,
    abort_reason TEXT,
    applied_parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exp_faults_world_status ON experiment_faults(world_id, status);
CREATE INDEX IF NOT EXISTS idx_exp_faults_timing ON experiment_faults(scheduled_start_micros, scheduled_duration_micros);

-- 3. Circuit breaker state snapshots (for control plane & UI inspection)
CREATE TABLE IF NOT EXISTS circuit_breaker_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id UUID REFERENCES service_dependencies(id) ON DELETE CASCADE,
    current_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED', -- CLOSED, OPEN, HALF_OPEN
    state_entered_at_micros BIGINT NOT NULL DEFAULT 0,
    failure_rate_ppm INTEGER NOT NULL DEFAULT 0, -- parts per million (0 - 1,000,000)
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_rejections BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_breaker_world_service_edge UNIQUE (world_id, service_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_cb_states_lookup ON circuit_breaker_states(world_id, current_state);

-- 4. Circuit breaker transition log (audit history of state changes)
CREATE TABLE IF NOT EXISTS circuit_breaker_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id UUID REFERENCES service_dependencies(id) ON DELETE CASCADE,
    from_state VARCHAR(20) NOT NULL,
    to_state VARCHAR(20) NOT NULL,
    transition_reason VARCHAR(100) NOT NULL, -- THRESHOLD_EXCEEDED, SLEEP_WINDOW_EXPIRED, PROBE_SUCCESS, PROBE_FAILED, MANUAL_OVERRIDE
    event_micros BIGINT NOT NULL,
    failure_rate_ppm INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cb_transitions_timeline ON circuit_breaker_transitions(world_id, event_micros DESC);
