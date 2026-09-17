-- Services
CREATE TABLE IF NOT EXISTS services (
  id                 VARCHAR(36) PRIMARY KEY,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  service_type       VARCHAR(255) NOT NULL DEFAULT 'HTTP'
                  CHECK (service_type IN ('HTTP','GRPC','WORKER','DATABASE','CACHE','MESSAGE_BROKER')),
  status             VARCHAR(255) NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  target_instances   INT NOT NULL DEFAULT 1 CHECK (target_instances >= 1 AND target_instances <= 100),
  concurrency_limit  INT NOT NULL DEFAULT 64 CHECK (concurrency_limit >= 1),
  queue_capacity     INT NOT NULL DEFAULT 1000 CHECK (queue_capacity >= 0),
  config             JSON NOT NULL DEFAULT ('{}'),
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL,
  UNIQUE(world_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX services_world_status_idx ON services (world_id, status);

-- Service instances
CREATE TABLE IF NOT EXISTS service_instances (
  id                 VARCHAR(36) PRIMARY KEY,
  service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  instance_index     INT NOT NULL,
  status             VARCHAR(255) NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  container_id       VARCHAR(36),
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL,
  UNIQUE(service_id, instance_index)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Service dependencies (directed edges)
CREATE TABLE IF NOT EXISTS service_dependencies (
  id                 VARCHAR(36) PRIMARY KEY,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_service_id  VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  target_service_id  VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  timeout_ms         INT NOT NULL DEFAULT 5000 CHECK (timeout_ms > 0),
  criticality        VARCHAR(255) NOT NULL DEFAULT 'REQUIRED'
                  CHECK (criticality IN ('REQUIRED','OPTIONAL','BEST_EFFORT')),
  retry_policy       JSON NOT NULL DEFAULT ('{"type":"EXPONENTIAL","maxAttempts":3,"baseDelayMs":100,"maxDelayMs":30000,"jitterFactor":0.25,"budgetPercent":20}'),
  circuit_breaker_policy JSON NOT NULL DEFAULT ('{"enabled":true,"threshold":5,"windowMs":10000,"cooldownMs":30000,"halfOpenProbes":3}'),
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL,
  UNIQUE(source_service_id, target_service_id),
  CHECK (source_service_id != target_service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX service_deps_source_idx ON service_dependencies (source_service_id);
CREATE INDEX service_deps_target_idx ON service_dependencies (target_service_id);
CREATE INDEX service_deps_world_idx  ON service_dependencies (world_id);

-- Workloads
CREATE TABLE IF NOT EXISTS workloads (
  id                 VARCHAR(36) PRIMARY KEY,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  target_service_id  VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pattern            VARCHAR(255) NOT NULL DEFAULT 'CONSTANT'
                  CHECK (pattern IN ('CONSTANT','RAMP_UP','RAMP_DOWN','BURST','SPIKE','RANDOM')),
  base_rate          DECIMAL(18,6) NOT NULL CHECK (base_rate >= 0),
  peak_rate          DECIMAL(18,6),
  duration_ms        BIGINT UNSIGNED,
  config             JSON NOT NULL DEFAULT ('{}'),
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL,
  UNIQUE(world_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
