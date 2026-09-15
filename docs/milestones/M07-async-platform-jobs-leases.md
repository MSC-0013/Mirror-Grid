# M07 — Async Platform: Distributed Jobs, Leases, and Dead-Letter Queues

## 1. Context

Heavy distributed-systems workflows cannot run synchronously inside Fastify HTTP request handlers:
- A 5-minute Monte Carlo experiment run or multi-world stress test exceeds gateway HTTP timeouts (typically 30s).
- Running long CPU-intensive tasks on web server threads degrades API responsiveness for all users.
- If a server crashes midway through a long simulation, in-memory state is lost with no audit trail or recovery.

To handle asynchronous computation reliably, MIRRORGRID requires an industrial-grade asynchronous
job execution platform:
1. **Transactional Enqueue:** Jobs are enqueued in the same Postgres transaction as domain state,
   guaranteeing that an uncommitted transaction never spawns an orphan job.
2. **Zero-Duplicate Concurrency:** Worker pools claim jobs concurrently using PostgreSQL `FOR UPDATE SKIP LOCKED`,
   ensuring exactly-once claim semantics without Redis locking overhead.
3. **Lease Heartbeating and Fencing Tokens:** Long-running jobs hold leases renewed by heartbeats.
   If a worker experiences a long GC pause or network partition, monotonic fencing tokens prevent
   zombie workers from overwriting clean state.
4. **Poison Pill Quarantine and Dead-Letter Queue (DLQ):** Repeatedly failing jobs are isolated into
   a DLQ with full diagnostic context and one-click replay capability.

---

## 2. Prerequisites

- M05 green (`verify:flagship` — Tier 1 core completed)
- M06 green (`verify:m6` — security and RBAC)
- Docker Compose profile: `--profile core` (Postgres and Redis)

---

## 3. Scope

### In scope
- `packages/jobs`: Core distributed job engine, lease heartbeat manager, and priority queue processor.
- Concurrency-safe job claiming using PostgreSQL `FOR UPDATE SKIP LOCKED`.
- Monotonic fencing tokens preventing split-brain writes during worker pauses.
- Dynamic exponential backoff with decorrelated jitter on job failures.
- Poison pill isolation: jobs exceeding `max_attempts` migrate to `dead_letter_jobs`.
- Database migration `008_jobs.sql`: `async_jobs`, `job_attempts`, `dead_letter_jobs`, and worker leases.
- Control API: Job status inspection, manual job cancellation, DLQ browsing, and job replay.
- Web UI: Background Jobs Dashboard & DLQ Triage Console (§72).

### Explicitly out of scope
- Kafka-based pub/sub message streaming (M08 — M07 is task/worker execution; M08 is CQRS event bus).
- Complex DAG dependency execution workflows (M07 jobs are discrete units of work).
- Real-time WebSocket job progress streaming (M08 — polling used until M08).

---

## 4. Design

### Transactional Job Enqueue (Why Postgres over external broker)

External job queues like RabbitMQ or BullMQ suffer from the dual-write problem:
```
// THE BUGGY PATTERN:
await db.insert(experiments).values(experimentData); // Succeeds
await queue.push(experimentId);                     // Network error! Job lost forever.
```
If the database insert succeeds but the queue push fails, the system is permanently inconsistent.
Conversely, if the queue push succeeds and the DB transaction rolls back, a worker attempts to process
a nonexistent entity.

In MIRRORGRID, jobs are stored in PostgreSQL:
```typescript
// THE ATOMIC PATTERN:
await db.transaction(async (tx) => {
  const exp = await tx.insert(experiments).values(data).returning();
  await jobService.enqueueTransactional(tx, {
    queue: 'experiments',
    type: 'RUN_EXPERIMENT',
    payload: { experimentId: exp.id },
  });
});
```
The job exists if and only if the business transaction commits.

### Concurrency-Safe Claim via `FOR UPDATE SKIP LOCKED`

Workers poll or respond to Postgres `LISTEN/NOTIFY` events. To claim a job without lock contention:

```sql
UPDATE async_jobs
SET
    status = 'CLAIMED',
    worker_id = $1,
    lease_expires_at = NOW() + INTERVAL '30 seconds',
    fencing_token = fencing_token + 1,
    updated_at = NOW()
WHERE id = (
    SELECT id
    FROM async_jobs
    WHERE status = 'QUEUED'
      AND run_at <= NOW()
    ORDER BY priority DESC, run_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
RETURNING *;
```
- `SKIP LOCKED` instructs Postgres to skip rows currently locked by other concurrent workers.
- 50 workers querying simultaneously execute in parallel with **zero lock waits** and **zero duplicate claims**.

### Fencing Tokens & Split-Brain Prevention

When a worker claims a job, it receives a monotonically increasing `fencing_token`:

```
+---------------+                      +---------------+
|   Worker A    |                      |   Worker B    |
| token = 1     |                      | token = 2     |
+---------------+                      +---------------+
        |                                      |
   [GC Pause 45s]                              |
   (Lease expires)                             |
        |                                      |
        |                         claims job (token = 2)
        |                         executes and completes
        |                                      |
   wakes up from GC                            |
   attempts to complete                        |
   UPDATE ... WHERE token = 1                  |
   ==> 0 rows updated (REJECTED!)              |
```

When Worker A wakes up and attempts to write its output, its query specifies:
`WHERE id = $1 AND fencing_token = 1`.
Because Worker B bumped `fencing_token` to 2, Worker A’s write affects 0 rows and is rejected.
Split-brain write corruption is mathematically impossible.

### Poison Pill Detection & Dead-Letter Queue (DLQ)

If a job throws an uncaught exception (e.g. malformed data causing memory overflow):
1. The error message and full stack trace are appended to `job_attempts`.
2. If `attempts < max_attempts`: Status returns to `QUEUED` with exponential backoff:
   $$\text{backoff} = \min(3600\text{s}, 2^{\text{attempt}} \times 5\text{s}) + \text{jitter}$$
3. If `attempts >= max_attempts`: The job is declared a **poison pill** and atomically moved to `dead_letter_jobs`.
4. An alert is emitted to the audit log, and the job is preserved indefinitely for operator triage.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/008_jobs.sql`:

```sql
-- 008_jobs.sql: Async jobs, execution leases, attempts history, and dead-letter queue

-- 1. Main async jobs table
CREATE TABLE async_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    queue_name VARCHAR(50) NOT NULL DEFAULT 'default',
    job_type VARCHAR(100) NOT NULL, -- e.g. 'RUN_EXPERIMENT', 'IMPORT_TOPOLOGY', 'GENERATE_REPORT'
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    priority INTEGER NOT NULL DEFAULT 100, -- Higher number = higher priority
    status VARCHAR(30) NOT NULL DEFAULT 'QUEUED', -- QUEUED, CLAIMED, RUNNING, COMPLETED, FAILED, RETRYING
    worker_id VARCHAR(120),
    fencing_token BIGINT NOT NULL DEFAULT 1,
    lease_expires_at TIMESTAMPTZ,
    run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    result_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_claim ON async_jobs(queue_name, status, run_at, priority DESC)
    WHERE status IN ('QUEUED', 'RETRYING');
CREATE INDEX idx_jobs_lease ON async_jobs(status, lease_expires_at)
    WHERE status IN ('CLAIMED', 'RUNNING');

-- 2. Job execution attempts audit history
CREATE TABLE job_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES async_jobs(id) ON DELETE CASCADE,
    attempt_number INTEGER NOT NULL,
    worker_id VARCHAR(120) NOT NULL,
    error_message TEXT,
    stack_trace TEXT,
    duration_ms INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_job_attempts_job ON job_attempts(job_id);

-- 3. Dead-Letter Queue (DLQ) for quarantined poison pills
CREATE TABLE dead_letter_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_job_id UUID NOT NULL,
    queue_name VARCHAR(50) NOT NULL,
    job_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL,
    failure_reason TEXT NOT NULL,
    total_attempts INTEGER NOT NULL,
    last_error_stack TEXT,
    quarantined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(120),
    resolution_status VARCHAR(30) NOT NULL DEFAULT 'UNRESOLVED' -- UNRESOLVED, REPLAYED, DISCARDED
);

CREATE INDEX idx_dlq_status ON dead_letter_jobs(resolution_status, quarantined_at DESC);
```

### Index rationale
- `idx_jobs_claim`: High-performance partial index covering only runnable jobs. The worker claim query
  never scans completed or archived records.
- `idx_jobs_lease`: Partial index for rapid reaper queries that locate abandoned leases.

---

## 6. Packages

```
packages/jobs/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public API
│   ├── client/
│   │   ├── job-client.ts            # Transactional enqueue client
│   │   └── types.ts                 # Job definition & payload types
│   ├── worker/
│   │   ├── worker-pool.ts           # Concurrency-controlled worker manager
│   │   ├── claim-engine.ts          # Postgres SKIP LOCKED claim loop
│   │   ├── lease-manager.ts         # Heartbeat lease renewer & fencing token validator
│   │   └── backoff.ts               # Exponential backoff with full jitter
│   └── dlq/
│       ├── dlq-manager.ts           # Poison pill quarantine and replay logic
│       └── inspector.ts             # Diagnostic stack trace parser
packages/db/
├── src/
│   ├── schema/
│   │   └── jobs.ts                  # Drizzle schema matching 008_jobs.sql
│   └── migrations/
│       └── 008_jobs.sql             # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       └── jobs/
│           ├── job.routes.ts        # Fastify routes for job inspection & DLQ
│           ├── job.controller.ts
│           ├── job.service.ts
│           └── job.schema.ts        # zod schemas
apps/web/
├── src/
│   └── app/
│       └── settings/
│           └── jobs/
│               ├── page.tsx         # Background Jobs & Worker Fleet Dashboard (§72)
│               └── dlq/
│                   └── page.tsx     # DLQ Triage Console with one-click replay (§72)
```

---

## 7. Interfaces

### Job Definition and Worker Contract

```typescript
// packages/jobs/src/client/types.ts

export interface JobOptions {
  readonly queueName?: string;
  readonly priority?: number;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
}

export interface EnqueuedJob<T = unknown> {
  readonly id: string;
  readonly queueName: string;
  readonly jobType: string;
  readonly payload: T;
  readonly priority: number;
  readonly status: 'QUEUED' | 'CLAIMED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'RETRYING';
  readonly runAt: Date;
}

export interface JobExecutionContext<T = unknown> {
  readonly jobId: string;
  readonly jobType: string;
  readonly payload: T;
  readonly attempt: number;
  readonly fencingToken: bigint;
  readonly signal: AbortSignal;
  /** Keep the job lease alive during long executions */
  heartbeat(): Promise<void>;
}

export type JobHandler<T = unknown, R = unknown> = (ctx: JobExecutionContext<T>) => Promise<R>;

export interface WorkerPoolConfig {
  readonly workerId: string;
  readonly concurrency: number;
  readonly pollIntervalMs: number;
  readonly leaseDurationMs: number;
  readonly queues: readonly string[];
}
```

### DLQ Manager Interface

```typescript
// packages/jobs/src/dlq/dlq-manager.ts

export interface DeadLetterJob {
  readonly id: string;
  readonly originalJobId: string;
  readonly queueName: string;
  readonly jobType: string;
  readonly payload: Record<string, unknown>;
  readonly failureReason: string;
  readonly totalAttempts: number;
  readonly lastErrorStack?: string;
  readonly quarantinedAt: Date;
  readonly resolutionStatus: 'UNRESOLVED' | 'REPLAYED' | 'DISCARDED';
}

export interface DlqManager {
  listQuarantined(options: { page: number; limit: number }): Promise<readonly DeadLetterJob[]>;
  replayJob(dlqId: string, actor: string): Promise<{ readonly replayedJobId: string }>;
  discardJob(dlqId: string, actor: string): Promise<void>;
}
```

---

## 8. API

Routes registered under `/api/v1/jobs` in `apps/control`.

### 1. Enqueue Async Job
- `POST /api/v1/jobs`
- **Request Body (zod schema):**
  ```typescript
  export const enqueueJobSchema = z.object({
    queueName: z.string().default('default'),
    jobType: z.string().min(1),
    payload: z.record(z.unknown()),
    priority: z.number().int().default(100),
    delayMs: z.number().int().nonnegative().optional(),
    maxAttempts: z.number().int().positive().default(5),
  });
  ```
- **Response:** `202 Accepted` with `{ jobId: string, status: 'QUEUED' }`.

### 2. Get Job Status & History
- `GET /api/v1/jobs/:id`
- **Response:** `200 OK` with job status, lease information, and array of previous attempts.

### 3. Query Dead-Letter Queue
- `GET /api/v1/jobs/dlq`
- **Query Params:** `status=UNRESOLVED&page=1&limit=25`
- **Response:** `200 OK` with list of quarantined poison pills.

### 4. Replay Dead-Letter Job
- `POST /api/v1/jobs/dlq/:dlqId/replay`
- **Response:** `200 OK` with `{ status: 'REPLAYED', newJobId: string }`.

### 5. Discard Dead-Letter Job
- `POST /api/v1/jobs/dlq/:dlqId/discard`
- **Response:** `200 OK` with `{ status: 'DISCARDED' }`.

---

## 9. UI

### 1. Background Jobs Dashboard (`apps/web/src/app/settings/jobs/page.tsx`)
- **Spec alignment:** §72 (Background Workers & Asynchronous Platform).
- **Layout:**
  - HUD Metric Cards: `Active Workers (N)`, `Queued Jobs (N)`, `Jobs/min Throughput`, `DLQ Quarantined (N red badge)`.
  - Live Queue Table: Queue Name, Concurrency, Pending count, Processing count, Avg latency.
  - Active Jobs Drawer: Live table of currently running jobs with duration timers and active worker IDs.

### 2. DLQ Triage Console (`apps/web/src/app/settings/jobs/dlq/page.tsx`)
- **Spec alignment:** §72 (Dead-Letter Triage Console).
- **Layout:**
  - Header: Alert banner showing unresolved quarantined jobs count.
  - Triage Grid: Job Type, Original Job ID, Failure Reason snippet, Quarantined Date, Total Attempts.
  - Diagnostic Inspector (Side Sheet):
    - Raw input payload viewer (JSON formatted).
    - Exception stack trace with highlighted failure frame.
    - Attempt history timeline.
    - Actions: `Replay Job (Re-enqueue)` and `Discard Job`.

---

## 10. Steps

1. **Create `packages/jobs` package:** Initialize package structure, dependencies, and TypeScript config.
2. **Build `SKIP LOCKED` claim engine:** Implement atomic claiming query with queue prioritization.
3. **Build Lease Heartbeat Manager:** Implement background heartbeat renewal and fencing token check.
4. **Implement Exponential Backoff & Jitter:** Build decorrelated jitter algorithm for failed attempts.
5. **Implement DLQ Quarantine Engine:** Automatically route jobs exceeding `max_attempts` to `dead_letter_jobs`.
6. **Implement Worker Pool supervisor:** Build multi-tenant worker loop with graceful SIGTERM drain.
7. **Database migration `008_jobs.sql`:** Apply schema and partial indexes in Postgres.
8. **Build Control Plane Job endpoints:** Implement API routes for job inspection, cancellation, and DLQ management.
9. **Build Background Jobs Dashboard:** Implement `apps/web/src/app/settings/jobs/page.tsx`.
10. **Build DLQ Triage Console:** Implement `apps/web/src/app/settings/jobs/dlq/page.tsx`.
11. **Connect Experiment Engine to Async Platform:** Refactor long experiment runs to execute via background workers.
12. **Implement `npm run verify:concurrency` gate script:** Multi-threaded concurrency verification suite.

---

## 11. Testing

### Unit tests (`packages/jobs/tests/unit`)
- `backoff.test.ts`: Verify exponential backoff curves and jitter boundaries.
- `fencing-token.test.ts`: Assert stale fencing tokens are rejected during completion writes.
- `dlq.test.ts`: Assert poison pill transitions from `async_jobs` to `dead_letter_jobs` after attempt threshold.

### Concurrency Stress Test (`packages/jobs/tests/concurrency`)
- Enqueue 500 jobs across 3 priority levels.
- Spin up 10 parallel worker threads in Node.js.
- Assert every job is processed exactly once (zero duplicate execution).
- Assert higher priority jobs complete before lower priority jobs.

### Integration tests (`apps/control/tests/integration/jobs`)
- Verify transactional enqueue rolls back if enclosing DB transaction throws.
- Verify DLQ replay re-enqueues job with clean attempt count and records resolution in audit log.

---

## 12. Gate

Command: `npm run verify:concurrency`

The gate test executes high-concurrency worker stress tests and validates these 5 assertions:

```typescript
// tests/gates/verify-concurrency.ts

// Assertion 1: 500 concurrent jobs processed by 10 workers with exactly-once execution
assert(totalProcessed === 500 && duplicateExecutions === 0, 'Assertion 1: Exactly-once execution verified');

// Assertion 2: Stale lease fencing token write is rejected
assert(staleTokenRejected, 'Assertion 2: Monotonic fencing token prevents zombie write');

// Assertion 3: Poison pill automatically transitions to DLQ after max_attempts
assert(poisonPillQuarantinedInDlq, 'Assertion 3: Poison pill quarantined to DLQ');

// Assertion 4: Transactional enqueue is atomic with Postgres database operations
assert(abortedTransactionDidNotEnqueue, 'Assertion 4: Rollback cleanly prevents job enqueue');

// Assertion 5: Worker pool gracefully finishes in-flight jobs on SIGINT
assert(gracefulDrainCompleted, 'Assertion 5: Worker pool drains gracefully on shutdown');
```

---

## 13. Pitfalls

1. **Tight polling loops against Postgres:** If workers poll without delay when queues are empty,
   Postgres CPU spikes to 100%. Always use `LISTEN/NOTIFY` combined with exponential polling backoff.
2. **Missing fencing token checks on multi-step jobs:** If a job performs 3 discrete mutations,
   it must verify the lease and fencing token before *each* mutating step, not just at the end.
3. **Long transactions holding row locks:** The claim query must immediately commit its transaction
   once the status is updated to `CLAIMED`. Never keep the claim transaction open while the job executes.
4. **Swallowing unhandled promise rejections:** A crash in a job handler must bubble to the worker supervisor
   so it can record the attempt failure and schedule backoff.

---

## 14. Done

- [ ] `packages/jobs` compiles under strict TypeScript with 0 errors.
- [ ] PostgreSQL `SKIP LOCKED` claim engine guarantees zero duplicate executions.
- [ ] Monotonic fencing tokens prevent split-brain writes on expired leases.
- [ ] DLQ quarantines poison pills with full stack traces.
- [ ] Migration `008_jobs.sql` applied cleanly in Postgres.
- [ ] Background Jobs Dashboard and DLQ Triage Console live in web UI.
- [ ] `npm run verify:concurrency` runs green in CI with all 5 gate assertions passing.
