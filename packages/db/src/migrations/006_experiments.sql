-- 006_experiments.sql: Experiments, runs, detectors, and execution event logs

-- 1. Experiments definition table
CREATE TABLE IF NOT EXISTS experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    hypothesis TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', -- DRAFT, SCHEDULED, RUNNING, COMPLETED, ABORTED, ARCHIVED
    version INTEGER NOT NULL DEFAULT 1,
    baseline_duration_micros BIGINT NOT NULL DEFAULT 30000000, -- 30s
    fault_duration_micros BIGINT NOT NULL DEFAULT 30000000,    -- 30s
    cooldown_duration_micros BIGINT NOT NULL DEFAULT 15000000, -- 15s
    frozen_config JSONB,                                      -- Populated when moved to SCHEDULED/RUNNING
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_experiments_world ON experiments(world_id, status);

-- 2. Extend experiment_runs for experiment lifecycle execution
ALTER TABLE experiment_runs
  ADD COLUMN IF NOT EXISTS experiment_id UUID REFERENCES experiments(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS run_number INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS current_phase VARCHAR(30) NOT NULL DEFAULT 'WARMUP',
  ADD COLUMN IF NOT EXISTS mttd_micros BIGINT,
  ADD COLUMN IF NOT EXISTS mttr_micros BIGINT,
  ADD COLUMN IF NOT EXISTS peak_error_rate_ppm INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS peak_p99_micros BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS result_summary JSONB DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_exp_runs_experiment ON experiment_runs(experiment_id);

-- 3. Anomaly detectors configured for an experiment
CREATE TABLE IF NOT EXISTS experiment_detectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    detector_type VARCHAR(50) NOT NULL, -- ERROR_RATE, P99_LATENCY, CIRCUIT_TRIPPED, QUEUE_SATURATION
    target_service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id UUID REFERENCES service_dependencies(id) ON DELETE CASCADE,
    threshold_value NUMERIC(12, 4) NOT NULL,
    window_duration_micros BIGINT NOT NULL DEFAULT 5000000, -- 5s sliding window
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detectors_experiment ON experiment_detectors(experiment_id);

-- 4. Immutable timeline events generated during a run
CREATE TABLE IF NOT EXISTS experiment_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros BIGINT NOT NULL,
    event_category VARCHAR(50) NOT NULL, -- PHASE_CHANGE, FAULT_INJECTED, FAULT_CLEARED, DETECTOR_TRIGGERED, DETECTOR_RESOLVED, BREAKER_STATE
    summary VARCHAR(255) NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exp_events_timeline ON experiment_events(run_id, sim_time_micros ASC);
