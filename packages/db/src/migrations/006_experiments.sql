-- 006_experiments.sql: Experiments, runs, detectors, and execution event logs

-- 1. Experiments definition table
CREATE TABLE IF NOT EXISTS experiments (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    hypothesis         VARCHAR(255) NOT NULL,
    status             VARCHAR(255) NOT NULL DEFAULT 'DRAFT',
    version            INT NOT NULL DEFAULT 1,
    baseline_duration_micros BIGINT UNSIGNED NOT NULL DEFAULT 30000000,
    fault_duration_micros BIGINT UNSIGNED NOT NULL DEFAULT 30000000,
    cooldown_duration_micros BIGINT UNSIGNED NOT NULL DEFAULT 15000000,
    frozen_config      JSON,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_experiments_world ON experiments(world_id, status);

-- 2. Extend experiment_runs for experiment lifecycle execution
ALTER TABLE experiment_runs ADD COLUMN experiment_id VARCHAR(36);
ALTER TABLE experiment_runs ADD COLUMN run_number INT NOT NULL DEFAULT 1;
ALTER TABLE experiment_runs ADD COLUMN current_phase VARCHAR(255) NOT NULL DEFAULT 'WARMUP';
ALTER TABLE experiment_runs ADD COLUMN mttd_micros BIGINT UNSIGNED;
ALTER TABLE experiment_runs ADD COLUMN mttr_micros BIGINT UNSIGNED;
ALTER TABLE experiment_runs ADD COLUMN peak_error_rate_ppm INT DEFAULT 0;
ALTER TABLE experiment_runs ADD COLUMN peak_p99_micros BIGINT UNSIGNED DEFAULT 0;
ALTER TABLE experiment_runs ADD COLUMN result_summary JSON DEFAULT ('{}');

CREATE INDEX idx_exp_runs_experiment ON experiment_runs(experiment_id);

-- 3. Anomaly detectors configured for an experiment
CREATE TABLE IF NOT EXISTS experiment_detectors (
    id                 VARCHAR(36) PRIMARY KEY,
    experiment_id      VARCHAR(36) NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    detector_type      VARCHAR(255) NOT NULL,
    target_service_id  VARCHAR(36) REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id     VARCHAR(36) REFERENCES service_dependencies(id) ON DELETE CASCADE,
    threshold_value    DECIMAL(18,6) NOT NULL,
    window_duration_micros BIGINT UNSIGNED NOT NULL DEFAULT 5000000,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_detectors_experiment ON experiment_detectors(experiment_id);

-- 4. Immutable timeline events generated during a run
CREATE TABLE IF NOT EXISTS experiment_events (
    id                 VARCHAR(36) PRIMARY KEY,
    run_id             VARCHAR(36) NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros    BIGINT UNSIGNED NOT NULL,
    event_category     VARCHAR(255) NOT NULL,
    summary            TEXT NOT NULL,
    details            JSON DEFAULT ('{}'),
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_exp_events_timeline ON experiment_events(run_id, sim_time_micros ASC);
