-- Migration 014: Campaign Runs and Scenario Results
CREATE TABLE IF NOT EXISTS campaign_runs (
  id                 VARCHAR(36) PRIMARY KEY,
  world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  total_scenarios    INT NOT NULL DEFAULT 20,
  passed_scenarios   INT NOT NULL DEFAULT 0,
  failed_scenarios   INT NOT NULL DEFAULT 0,
  total_throughput_rps DOUBLE NOT NULL DEFAULT 0.0,
  p99_latency_ms     DOUBLE NOT NULL DEFAULT 0.0,
  heap_delta_bytes   INT NOT NULL DEFAULT 0,
  status             VARCHAR(255) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at         DATETIME(3) NOT NULL,
  completed_at       DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_campaign_runs_world ON campaign_runs(world_id, status);

CREATE TABLE IF NOT EXISTS campaign_scenarios (
  id                 VARCHAR(36) PRIMARY KEY,
  campaign_id        VARCHAR(36) NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  scenario_number    INT NOT NULL,
  name               VARCHAR(255) NOT NULL,
  category           VARCHAR(255) NOT NULL,
  duration_ms        INT NOT NULL,
  requests_offered   INT NOT NULL,
  requests_successful INT NOT NULL,
  availability_percentage DOUBLE NOT NULL,
  p99_ms             DOUBLE NOT NULL,
  status             VARCHAR(255) NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
  details_json       TEXT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_campaign_scenarios_campaign ON campaign_scenarios(campaign_id, scenario_number);
