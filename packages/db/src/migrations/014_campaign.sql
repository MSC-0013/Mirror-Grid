-- Migration 014: Campaign Runs and Scenario Results
CREATE TABLE IF NOT EXISTS campaign_runs (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  total_scenarios INTEGER NOT NULL DEFAULT 20,
  passed_scenarios INTEGER NOT NULL DEFAULT 0,
  failed_scenarios INTEGER NOT NULL DEFAULT 0,
  total_throughput_rps REAL NOT NULL DEFAULT 0.0,
  p99_latency_ms REAL NOT NULL DEFAULT 0.0,
  heap_delta_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'COMPLETED', 'FAILED')),
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_campaign_runs_world ON campaign_runs(world_id, status);

CREATE TABLE IF NOT EXISTS campaign_scenarios (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES campaign_runs(id) ON DELETE CASCADE,
  scenario_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  requests_offered INTEGER NOT NULL,
  requests_successful INTEGER NOT NULL,
  availability_percentage REAL NOT NULL,
  p99_ms REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PASSED', 'FAILED')),
  details_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_campaign_scenarios_campaign ON campaign_scenarios(campaign_id, scenario_number);
