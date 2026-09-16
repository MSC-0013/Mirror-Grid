-- Experiment runs (runtime execution metadata and state hashes)
CREATE TABLE IF NOT EXISTS experiment_runs (
  id                TEXT PRIMARY KEY,
  world_id          TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  seed              BLOB NOT NULL,
  runtime_mode      TEXT NOT NULL CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  engine_version    TEXT NOT NULL,
  schema_version    INT NOT NULL DEFAULT 1,
  git_commit        TEXT,
  lockfile_hash     TEXT,
  frozen_config     TEXT NOT NULL,
  config_hash       TEXT NOT NULL,
  final_state_hash  TEXT,
  status            TEXT NOT NULL DEFAULT 'CREATED'
                    CHECK (status IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at        INTEGER,
  completed_at      INTEGER,
  created_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS experiment_runs_world_idx   ON experiment_runs (world_id, status);
CREATE INDEX IF NOT EXISTS experiment_runs_created_idx ON experiment_runs (created_at DESC);

-- Per-second metric buckets
CREATE TABLE IF NOT EXISTS experiment_metrics (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  service_id         TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  virtual_time_us    BLOB NOT NULL,
  wall_time_ms       BLOB NOT NULL,
  requests_total     INT NOT NULL DEFAULT 0,
  requests_failed    INT NOT NULL DEFAULT 0,
  queue_depth        INT NOT NULL DEFAULT 0,
  active_slots       INT NOT NULL DEFAULT 0,
  circuit_state      TEXT CHECK (circuit_state IS NULL OR circuit_state IN ('CLOSED','OPEN','HALF_OPEN')),
  latency_samples_us TEXT,
  latency_histogram  TEXT
);

CREATE INDEX IF NOT EXISTS experiment_metrics_run_service_time_idx
  ON experiment_metrics (run_id, service_id, virtual_time_us);
