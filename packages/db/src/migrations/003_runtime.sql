-- Experiment runs (runtime execution metadata and state hashes)
CREATE TABLE IF NOT EXISTS experiment_runs (
  id                 VARCHAR(36) PRIMARY KEY,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  seed               BIGINT UNSIGNED NOT NULL,
  runtime_mode       VARCHAR(255) NOT NULL CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  engine_version     VARCHAR(255) NOT NULL,
  schema_version     INT NOT NULL DEFAULT 1,
  git_commit         VARCHAR(255),
  lockfile_hash      VARCHAR(64),
  frozen_config      TEXT NOT NULL,
  config_hash        VARCHAR(64) NOT NULL,
  final_state_hash   VARCHAR(64),
  status             VARCHAR(255) NOT NULL DEFAULT 'CREATED'
                    CHECK (status IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at         DATETIME(3),
  completed_at       DATETIME(3),
  created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX experiment_runs_world_idx   ON experiment_runs (world_id, status);
CREATE INDEX experiment_runs_created_idx ON experiment_runs (created_at DESC);

-- Per-second metric buckets
CREATE TABLE IF NOT EXISTS experiment_metrics (
  id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
  run_id             VARCHAR(36) NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  virtual_time_us    BIGINT UNSIGNED NOT NULL,
  wall_time_ms       BIGINT UNSIGNED NOT NULL,
  requests_total     INT NOT NULL DEFAULT 0,
  requests_failed    INT NOT NULL DEFAULT 0,
  queue_depth        INT NOT NULL DEFAULT 0,
  active_slots       INT NOT NULL DEFAULT 0,
  circuit_state      VARCHAR(255) CHECK (circuit_state IS NULL OR circuit_state IN ('CLOSED','OPEN','HALF_OPEN')),
  latency_samples_us TEXT,
  latency_histogram  TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX experiment_metrics_run_service_time_idx
  ON experiment_metrics (run_id, service_id, virtual_time_us);
