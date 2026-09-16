-- 006_experiments.sql: Experiments, runs, detectors, and execution event logs

-- 1. Experiments definition table
CREATE TABLE IF NOT EXISTS experiments (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    hypothesis TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    version INTEGER NOT NULL DEFAULT 1,
    baseline_duration_micros BLOB NOT NULL DEFAULT 30000000,
    fault_duration_micros BLOB NOT NULL DEFAULT 30000000,
    cooldown_duration_micros BLOB NOT NULL DEFAULT 15000000,
    frozen_config TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_experiments_world ON experiments(world_id, status);

-- 2. Extend experiment_runs for experiment lifecycle execution
ALTER TABLE experiment_runs ADD COLUMN experiment_id TEXT;
ALTER TABLE experiment_runs ADD COLUMN run_number INTEGER NOT NULL DEFAULT 1;
ALTER TABLE experiment_runs ADD COLUMN current_phase TEXT NOT NULL DEFAULT 'WARMUP';
ALTER TABLE experiment_runs ADD COLUMN mttd_micros BLOB;
ALTER TABLE experiment_runs ADD COLUMN mttr_micros BLOB;
ALTER TABLE experiment_runs ADD COLUMN peak_error_rate_ppm INTEGER DEFAULT 0;
ALTER TABLE experiment_runs ADD COLUMN peak_p99_micros BLOB DEFAULT 0;
ALTER TABLE experiment_runs ADD COLUMN result_summary TEXT DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_exp_runs_experiment ON experiment_runs(experiment_id);

-- 3. Anomaly detectors configured for an experiment
CREATE TABLE IF NOT EXISTS experiment_detectors (
    id TEXT PRIMARY KEY,
    experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    detector_type TEXT NOT NULL,
    target_service_id TEXT REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id TEXT REFERENCES service_dependencies(id) ON DELETE CASCADE,
    threshold_value NUMERIC NOT NULL,
    window_duration_micros BLOB NOT NULL DEFAULT 5000000,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_detectors_experiment ON experiment_detectors(experiment_id);

-- 4. Immutable timeline events generated during a run
CREATE TABLE IF NOT EXISTS experiment_events (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros BLOB NOT NULL,
    event_category TEXT NOT NULL,
    summary TEXT NOT NULL,
    details TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exp_events_timeline ON experiment_events(run_id, sim_time_micros ASC);
