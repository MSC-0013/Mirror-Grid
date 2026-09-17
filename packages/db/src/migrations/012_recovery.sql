-- 012_recovery.sql: World checkpoints, incremental Merkle components, and DR drills (MySQL 8.4)

-- 1. World Checkpoints table (Merkle roots)
CREATE TABLE IF NOT EXISTS world_snapshots (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id  VARCHAR(36) REFERENCES experiment_runs(id) ON DELETE CASCADE,
    sim_time_micros    INT NOT NULL,
    sequence_num       INT NOT NULL,
    merkle_root_hash   VARCHAR(64) NOT NULL,
    snapshot_type      VARCHAR(255) NOT NULL DEFAULT 'PERIODIC' CHECK (snapshot_type IN ('PERIODIC', 'TRIGGERED', 'MANUAL', 'PRE_FAULT')),
    trigger_reason     TEXT,
    total_components   INT NOT NULL,
    deduplicated_components INT NOT NULL,
    size_bytes         INT NOT NULL DEFAULT 0,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_snapshots_world_time ON world_snapshots(world_id, sim_time_micros ASC);
CREATE INDEX idx_snapshots_run ON world_snapshots(experiment_run_id, sequence_num ASC);

-- 2. Content-Addressable Component Snapshots
CREATE TABLE IF NOT EXISTS snapshot_components (
    id                 VARCHAR(36) PRIMARY KEY,
    snapshot_id        VARCHAR(36) NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    component_type     VARCHAR(255) NOT NULL CHECK (component_type IN ('SERVICE_STATE', 'CIRCUIT_BREAKER', 'QUEUE_STATE', 'FAULT_STATE')),
    component_id       VARCHAR(36) NOT NULL,
    component_hash     VARCHAR(64) NOT NULL,
    state_payload      JSON NOT NULL DEFAULT ('{}'),
    is_deduplicated    INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_snapshot_component UNIQUE (snapshot_id, component_type, component_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_components_lookup ON snapshot_components(component_hash);

-- 3. Disaster Recovery (DR) Drills and Restorations
CREATE TABLE IF NOT EXISTS dr_restorations (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    snapshot_id        VARCHAR(36) NOT NULL REFERENCES world_snapshots(id) ON DELETE CASCADE,
    restore_status     VARCHAR(255) NOT NULL DEFAULT 'IN_PROGRESS' CHECK (restore_status IN ('IN_PROGRESS', 'COMPLETED', 'FAILED')),
    rpo_micros         INT NOT NULL,
    rto_ms             INT NOT NULL,
    verification_hash_match INT NOT NULL DEFAULT 0,
    error_message      TEXT,
    restored_by        VARCHAR(36) NOT NULL,
    created_at         DATETIME(3) NOT NULL,
    completed_at       DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_dr_world ON dr_restorations(world_id, created_at DESC);
