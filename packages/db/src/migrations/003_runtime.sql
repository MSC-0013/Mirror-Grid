-- Experiment runs (runtime execution metadata and state hashes)
CREATE TABLE IF NOT EXISTS experiment_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id          UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  seed              BIGINT NOT NULL,
  runtime_mode      TEXT NOT NULL CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  engine_version    TEXT NOT NULL,
  schema_version    INT NOT NULL DEFAULT 1,
  git_commit        TEXT,
  lockfile_hash     TEXT,
  frozen_config     JSONB NOT NULL,
  config_hash       TEXT NOT NULL,
  final_state_hash  TEXT,
  status            TEXT NOT NULL DEFAULT 'CREATED'
                    CHECK (status IN ('CREATED','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS experiment_runs_world_idx   ON experiment_runs (world_id, status);
CREATE INDEX IF NOT EXISTS experiment_runs_created_idx ON experiment_runs (created_at DESC);

-- Per-second metric buckets (partitioned by run_id for zero-cost partition drops/archival)
CREATE TABLE IF NOT EXISTS experiment_metrics (
  id                 BIGSERIAL,
  run_id             UUID NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  service_id         UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  virtual_time_us    BIGINT NOT NULL,
  wall_time_ms       BIGINT NOT NULL,
  requests_total     INT NOT NULL DEFAULT 0,
  requests_failed    INT NOT NULL DEFAULT 0,
  queue_depth        INT NOT NULL DEFAULT 0,
  active_slots       INT NOT NULL DEFAULT 0,
  circuit_state      TEXT CHECK (circuit_state IN ('CLOSED','OPEN','HALF_OPEN')),
  latency_samples_us INT[],
  latency_histogram  INT[],
  PRIMARY KEY (id, run_id)
) PARTITION BY LIST (run_id);

-- Default partition for runs prior to dedicated partition creation
CREATE TABLE IF NOT EXISTS experiment_metrics_default PARTITION OF experiment_metrics DEFAULT;

CREATE INDEX IF NOT EXISTS experiment_metrics_run_service_time_idx
  ON experiment_metrics (run_id, service_id, virtual_time_us);
