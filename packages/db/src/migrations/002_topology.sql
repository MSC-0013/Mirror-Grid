-- Services
CREATE TABLE IF NOT EXISTS services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  service_type    TEXT NOT NULL DEFAULT 'HTTP'
                  CHECK (service_type IN ('HTTP','GRPC','WORKER','DATABASE','CACHE','MESSAGE_BROKER')),
  status          TEXT NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  target_instances INT NOT NULL DEFAULT 1 CHECK (target_instances >= 1 AND target_instances <= 100),
  concurrency_limit INT NOT NULL DEFAULT 64 CHECK (concurrency_limit >= 1),
  queue_capacity  INT NOT NULL DEFAULT 1000 CHECK (queue_capacity >= 0),
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(world_id, name)
);

CREATE INDEX IF NOT EXISTS services_world_status_idx ON services (world_id, status);

-- Service instances
CREATE TABLE IF NOT EXISTS service_instances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  instance_index  INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  container_id    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, instance_index)
);

-- Service dependencies (directed edges)
CREATE TABLE IF NOT EXISTS service_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  timeout_ms      INT NOT NULL DEFAULT 5000 CHECK (timeout_ms > 0),
  criticality     TEXT NOT NULL DEFAULT 'REQUIRED'
                  CHECK (criticality IN ('REQUIRED','OPTIONAL','BEST_EFFORT')),
  retry_policy    JSONB NOT NULL DEFAULT '{"type":"EXPONENTIAL","maxAttempts":3,"baseDelayMs":100,"maxDelayMs":30000,"jitterFactor":0.25,"budgetPercent":20}',
  circuit_breaker_policy JSONB NOT NULL DEFAULT '{"enabled":true,"threshold":5,"windowMs":10000,"cooldownMs":30000,"halfOpenProbes":3}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_service_id, target_service_id),
  CHECK (source_service_id != target_service_id)
);

CREATE INDEX IF NOT EXISTS service_deps_source_idx ON service_dependencies (source_service_id);
CREATE INDEX IF NOT EXISTS service_deps_target_idx ON service_dependencies (target_service_id);
CREATE INDEX IF NOT EXISTS service_deps_world_idx  ON service_dependencies (world_id);

-- Workloads
CREATE TABLE IF NOT EXISTS workloads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pattern         TEXT NOT NULL DEFAULT 'CONSTANT'
                  CHECK (pattern IN ('CONSTANT','RAMP_UP','RAMP_DOWN','BURST','SPIKE','RANDOM')),
  base_rate       NUMERIC NOT NULL CHECK (base_rate >= 0),
  peak_rate       NUMERIC,
  duration_ms     BIGINT,
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(world_id, name)
);
