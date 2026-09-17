-- 008_async_platform.sql: Async jobs, leases, worker heartbeats, and dead-letter queue

CREATE TABLE IF NOT EXISTS async_jobs (
    id                 VARCHAR(36) PRIMARY KEY,
    queue_name         VARCHAR(255) NOT NULL DEFAULT 'default',
    job_type           VARCHAR(255) NOT NULL,
    payload            TEXT NOT NULL DEFAULT '{}',
    status             VARCHAR(255) NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'DEAD_LETTER', 'CANCELLED')),
    priority           INT NOT NULL DEFAULT 100, -- Lower number = higher priority
    attempts           INT NOT NULL DEFAULT 0,
    max_attempts       INT NOT NULL DEFAULT 5,
    lease_owner        VARCHAR(255),
    lease_expires_at   DATETIME(3),
    run_at             DATETIME(3) NOT NULL,
    last_error         TEXT,
    created_at         DATETIME(3) NOT NULL,
    updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_jobs_claim 
    ON async_jobs(queue_name, status, run_at, priority ASC);
CREATE INDEX idx_jobs_lease 
    ON async_jobs(lease_owner, lease_expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id                 VARCHAR(36) PRIMARY KEY,
    original_job_id    VARCHAR(36) NOT NULL REFERENCES async_jobs(id) ON DELETE CASCADE,
    queue_name         VARCHAR(255) NOT NULL,
    job_type           VARCHAR(255) NOT NULL,
    payload            TEXT NOT NULL,
    failed_reason      TEXT NOT NULL,
    stack_trace        TEXT,
    exhausted_attempts INT NOT NULL,
    dead_lettered_at   DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_dlq_queue ON dead_letter_queue(queue_name, dead_lettered_at DESC);

CREATE TABLE IF NOT EXISTS worker_nodes (
    id                 VARCHAR(36) PRIMARY KEY,
    hostname           VARCHAR(255) NOT NULL,
    pid                INT NOT NULL,
    active_queues      TEXT NOT NULL DEFAULT '[]',
    concurrency        INT NOT NULL DEFAULT 4,
    last_heartbeat     INT NOT NULL,
    status             VARCHAR(255) NOT NULL DEFAULT 'ALIVE' CHECK (status IN ('ALIVE', 'DRAINING', 'DEAD')),
    started_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_workers_heartbeat ON worker_nodes(status, last_heartbeat DESC);
