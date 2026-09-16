-- 008_async_platform.sql: Async jobs, leases, worker heartbeats, and dead-letter queue

CREATE TABLE IF NOT EXISTS async_jobs (
    id TEXT PRIMARY KEY,
    queue_name TEXT NOT NULL DEFAULT 'default',
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED')),
    priority INTEGER NOT NULL DEFAULT 100, -- Lower number = higher priority
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    lease_owner TEXT,
    lease_expires_at INTEGER,
    run_at INTEGER NOT NULL,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_claim 
    ON async_jobs(queue_name, status, run_at, priority ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_lease 
    ON async_jobs(lease_owner, lease_expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id TEXT PRIMARY KEY,
    original_job_id TEXT NOT NULL REFERENCES async_jobs(id) ON DELETE CASCADE,
    queue_name TEXT NOT NULL,
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    failed_reason TEXT NOT NULL,
    stack_trace TEXT,
    exhausted_attempts INTEGER NOT NULL,
    dead_lettered_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dlq_queue ON dead_letter_queue(queue_name, dead_lettered_at DESC);

CREATE TABLE IF NOT EXISTS worker_nodes (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL,
    pid INTEGER NOT NULL,
    active_queues TEXT NOT NULL DEFAULT '[]',
    concurrency INTEGER NOT NULL DEFAULT 4,
    last_heartbeat INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'ALIVE' CHECK (status IN ('ALIVE', 'DRAINING', 'DEAD')),
    started_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON worker_nodes(status, last_heartbeat DESC);
