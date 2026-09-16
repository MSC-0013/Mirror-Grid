-- 012_recovery.sql: World checkpoints, incremental Merkle components, and DR drills (SQLite WAL mode)

-- 1. World Checkpoints table (Merkle roots)
CREATE TABLE IF NOT EXISTS world_snapshots (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id TEXT REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros INTEGER NOT NULL,
    sequence_num INTEGER NOT NULL,
    merkle_root_hash TEXT NOT NULL,
    snapshot_type TEXT NOT NULL DEFAULT 'PERIODIC' CHECK (snapshot_type IN ('PERIODIC', 'TRIGGERED', 'MANUAL', 'PRE_FAULT')),
    trigger_reason TEXT,
    total_components INTEGER NOT NULL,
    deduplicated_components INTEGER NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_world_time ON world_snapshots(world_id, sim_time_micros ASC);
CREATE INDEX IF NOT EXISTS idx_snapshots_run ON world_snapshots(experiment_run_id, sequence_num ASC);

-- 2. Content-Addressable Component Snapshots
CREATE TABLE IF NOT EXISTS snapshot_components (
    id TEXT PRIMARY KEY,
    snapshot_id TEXT NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    component_type TEXT NOT NULL CHECK (component_type IN ('SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE')),
    component_id TEXT NOT NULL,
    component_hash TEXT NOT NULL,
    state_payload TEXT NOT NULL DEFAULT '{}',
    is_deduplicated INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT uq_snapshot_component UNIQUE (snapshot_id, component_type, component_id)
);

CREATE INDEX IF NOT EXISTS idx_components_lookup ON snapshot_components(component_hash);

-- 3. Disaster Recovery (DR) Drills and Restorations
CREATE TABLE IF NOT EXISTS dr_restorations (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    snapshot_id TEXT NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    restore_status TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (restore_status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
    rpo_micros INTEGER NOT NULL,
    rto_ms INTEGER NOT NULL,
    verification_hash_match INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    restored_by TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_dr_world ON dr_restorations(world_id, created_at DESC);
