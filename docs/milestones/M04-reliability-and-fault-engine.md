# M04 — Reliability Primitives and Fault Engine

## 1. Context

Distributed systems fail in predictable structural patterns: a slow downstream dependency causes
concurrency saturation upstream; naive retry loops multiply traffic by 3x to 5x exactly when the target
is already drowning; uncoordinated recovery causes thundering herds that immediately re-collapse the
system; and cascading failure propagates across service boundaries faster than human operators can react.

MIRRORGRID exists to study, measure, and tame these phenomena. To do that credibly, our reliability
mechanisms (Circuit Breaker, Retry Policy with Budget, Bulkhead, Deadline Propagation, Token Bucket)
cannot be ad-hoc heuristics scattered through business logic. They must be mathematically rigorous,
formally state-modeled, and architected so that the exact same reliability logic operates in both:

1. The deterministic logical runtime (`packages/sim` running under virtual clock).
2. The real containerized runtime (`apps/synthetic-service` running in Docker under wall clock).

This milestone delivers `packages/reliability` — the shared core of resilience primitives — and the
Fault Engine that injects deterministic, controlled anomalies into service graphs. It also establishes
the Chaos Safety Boundary: an invariant engine that guarantees chaos experiments cannot escape control,
damage real infrastructure, or run indefinitely after an abort signal.

---

## 2. Prerequisites

- M01 gate green (`verify:m1` — domain model and topology graph)
- M02 gate green (`verify:determinism` — virtual clock and splittable RNG)
- Docker Compose profile: `--profile core` (Postgres only)

---

## 3. Scope

### In scope

- `packages/reliability`: Core mathematical state machines and admission controllers with zero runtime
  dependencies (`CircuitBreaker`, `RetryPolicy`, `RetryBudget`, `Bulkhead`, `DeadlineContext`, `TokenBucket`).
- Core / Shell architecture: pure state machines decoupled from time sources via the `Clock` port.
- Fault Engine: Formal fault specifications (Latency, Error, Jitter, Blackhole, PacketLoss, BandwidthLimit,
  CorruptedPayload, ServiceKill).
- Chaos Safety Boundary: Invariant guards, blast-radius budgets, auto-abort triggers on critical SLO burn,
  and emergency global kill-switch.
- Database migration `004_reliability.sql`: Fault specifications, experiment faults, breaker states,
  and transition audit history.
- Control API: Fault management, manual injection/disarm, breaker status inspection, safety overrides.
- UI: Circuit Breaker visualizer screen, Fault injection control console, Chaos safety status bar.

### Explicitly out of scope

- Toxiproxy container-level traffic interception (M03 — container runtime connects to this fault engine).
- Full multi-phase experiment orchestration with phases and baselines (M05 — experiment engine).
- Automated root-cause analysis and SLO burn rate calculations for SLA reports (M10).
- Live WebSocket push streaming (M08 — HTTP polling used until M08).

---

## 4. Design

### Core / Shell split

The foundational architectural decision of `packages/reliability` is strict separation between
state-machine transitions (Core) and runtime execution side-effects (Shell):

```
+-------------------------------------------------------------------------+
|                                  SHELL                                  |
|  Node / Fastify Middleware / gRPC Interceptor / Synthetic Proxy Sidecar |
|  - Reads wall clock or context deadline                                 |
|  - Schedules timers via globalThis.setTimeout                           |
|  - Emits telemetry metrics and logs                                     |
+-------------------------------------------------------------------------+
                                   | calls methods with time: bigint
                                   v
+-------------------------------------------------------------------------+
|                                  CORE                                   |
|  Pure TypeScript State Machines (packages/reliability/src/core)        |
|  - Zero I/O, zero global state, zero timers, zero Date.now()            |
|  - All transitions are deterministic functions: (State, Event, Now) =>  |
|    (NewState, Decision, SideEffectDescriptors)                          |
|  - Time is ALWAYS passed as integer microseconds (bigint)               |
|  - Randomness passed via splittable PRNG substream                      |
+-------------------------------------------------------------------------+
```

Because Core has zero dependencies and takes `nowMicros: bigint` explicitly, the logical simulator
(`packages/sim`) runs the exact same circuit breaker and bulkhead code as real production containers.
No behavior discrepancies can hide between simulation and reality.

### Circuit Breaker state machine

The Circuit Breaker models three states: `CLOSED`, `OPEN`, and `HALF_OPEN`.

```
                    failure_rate > threshold OR
                    consecutive_failures > limit
     +---------------------------------------------------------+
     |                                                         |
     v                                                         |
+----------+      sleep_window elapsed       +----------+      |
|          | ------------------------------> |          |      |
|  CLOSED  |                                 |   OPEN   |      |
|          | <------------------------------ |          |      |
+----------+   consecutive_successes >= trial+----------+      |
     ^                                             |           |
     |                                             | probe req |
     |                                             v           |
     |         probe success                +-----------+      |
     +------------------------------------- |           |      |
                                            | HALF_OPEN | -----+
                                            |           | probe fail
                                            +-----------+
```

Key nuances enforced:

- **Failure Counting:** Sliding window of fixed time buckets (e.g. 10 buckets of 1 second). Transitions
  do not evaluate until a minimum volume threshold (`volumeThreshold`, e.g. 20 requests) is reached,
  preventing a single failure during low traffic from tripping the breaker.
- **Half-Open Concurrency:** When entering `HALF_OPEN`, only a strictly limited concurrency
  (`halfOpenMaxConcurrent`, e.g. 2 requests) is permitted through. All other requests are rejected
  immediately with `AppError.circuitOpen()`.
- **Failures vs Client Errors:** Only upstream 5xx, timeouts, and network resets count as failures.
  Client errors (4xx) are explicitly ignored by default to prevent client abuse from tripping service circuits.

### Retry policy and Retry Budget (Anti-Storm guarantee)

Naive retries create catastrophic positive feedback loops: if a downstream service slows down,
callers timeout and retry, doubling or tripling load when downstream capacity has already collapsed.

MIRRORGRID implements **Retry Budgets** per RFC / Linkerd specification:

- Every successful request adds token fraction to the budget (e.g. 0.2 retries earned per success).
- Every retry consumes 1 full token.
- Max retries ratio is strictly capped (e.g. max 10% of total traffic can be retries).
- If the budget is exhausted, further retries are rejected immediately, and the original error is returned.

Backoff formula: **Decorrelated Jitter** or **Full Jitter** (Amazon Builder's Library):

```
sleep = min(capMicros, random_between(0, baseMicros * (2 ^ attempt)))
```

All random choices consume from a deterministic PRNG substream (`rng.stream('retry:edge:<edgeId>')`).

### Bulkhead admission control

The Bulkhead protects service capacity by partitioning resources:

- Max concurrent active calls (`maxConcurrent`).
- Bounded wait queue (`maxQueueCapacity`) with queue timeout (`queueTimeoutMicros`).
- When both active slots and queue are full, request is shed immediately with `AppError.rateLimited('BULKHEAD_FULL')`.
- Shed requests hold zero downstream resources.

### Deadline propagation (mg-deadline-at)

Deadlines are absolute integer microsecond timestamps representing the wall-clock or virtual-clock time
at which the client will give up waiting:

- In HTTP: header `mg-deadline-at: <micros>`.
- In gRPC: metadata key `mg-deadline-at`.
- Before making an outbound RPC or taking work off a queue:
  ```typescript
  const remaining = deadlineAt - nowMicros;
  if (remaining <= 0) {
    throw AppError.timeout('DEADLINE_EXCEEDED');
  }
  ```
- If remaining time is less than estimated downstream minimum latency, request is shed preemptively.

### Chaos Safety Boundary

Chaos engineering without automated guard rails is reckless. MIRRORGRID includes a strict safety boundary:

1. **Global Emergency Abort (`/api/v1/worlds/:worldId/chaos/abort`):** Immediately resets all active faults,
   unfreezes all injected latencies, closes or resets breakers to normal, and drops all drop rules.
2. **Blast Radius Cap:** Maximum percentage of edges concurrently degraded (default 30% of edges in a world).
3. **Auto-Abort Triggers (SLO Burn):** If the overall world error rate exceeds 50% for longer than 30 seconds
   (virtual or real), the safety boundary trips, auto-aborts the experiment, and logs an audit alert.
4. **Leased Fault Lifetimes:** Every fault has a maximum hard duration (`maxDurationMicros`). If the control plane
   crashes or disconnects, the fault expires automatically and fails safe.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/004_reliability.sql`:

```sql
-- 004_reliability.sql: Fault specifications, active faults, and circuit breaker tracking

-- 1. Fault specifications (reusable fault definitions)
CREATE TABLE fault_specifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    fault_type VARCHAR(50) NOT NULL, -- LATENCY, ERROR, PACKET_DROP, JITTER, BLACKHOLE, BANDWIDTH_LIMIT, CORRUPT_PAYLOAD, SERVICE_KILL
    target_service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    target_edge_id UUID REFERENCES service_edges(id) ON DELETE CASCADE,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    safety_rules JSONB NOT NULL DEFAULT '{"maxDurationMicros": 300000000, "autoAbortOnBurnRate": true}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_fault_target CHECK (
        (target_service_id IS NOT NULL AND target_edge_id IS NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NOT NULL) OR
        (target_service_id IS NULL AND target_edge_id IS NULL) -- Global world fault
    )
);

CREATE INDEX idx_fault_spec_world ON fault_specifications(world_id);
CREATE INDEX idx_fault_spec_target_svc ON fault_specifications(target_service_id) WHERE target_service_id IS NOT NULL;
CREATE INDEX idx_fault_spec_target_edge ON fault_specifications(target_edge_id) WHERE target_edge_id IS NOT NULL;

-- 2. Experiment fault executions (scheduled or active fault instances)
CREATE TABLE experiment_faults (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_id UUID, -- Optional foreign key to experiments table (added M05)
    fault_spec_id UUID NOT NULL REFERENCES fault_specifications(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED', -- SCHEDULED, ACTIVE, COMPLETED, ABORTED, FAILED
    scheduled_start_micros BIGINT NOT NULL,
    scheduled_duration_micros BIGINT NOT NULL,
    actual_start_micros BIGINT,
    actual_end_micros BIGINT,
    abort_reason TEXT,
    applied_parameters JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_exp_faults_world_status ON experiment_faults(world_id, status);
CREATE INDEX idx_exp_faults_timing ON experiment_faults(scheduled_start_micros, scheduled_duration_micros);

-- 3. Circuit breaker state snapshots (for control plane & UI inspection)
CREATE TABLE circuit_breaker_states (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id UUID REFERENCES service_edges(id) ON DELETE CASCADE,
    current_state VARCHAR(20) NOT NULL DEFAULT 'CLOSED', -- CLOSED, OPEN, HALF_OPEN
    state_entered_at_micros BIGINT NOT NULL DEFAULT 0,
    failure_rate_ppm INTEGER NOT NULL DEFAULT 0, -- parts per million (0 - 1,000,000)
    consecutive_failures INTEGER NOT NULL DEFAULT 0,
    consecutive_successes INTEGER NOT NULL DEFAULT 0,
    total_requests BIGINT NOT NULL DEFAULT 0,
    total_rejections BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_breaker_world_service_edge UNIQUE (world_id, service_id, edge_id)
);

CREATE INDEX idx_cb_states_lookup ON circuit_breaker_states(world_id, current_state);

-- 4. Circuit breaker transition log (audit history of state changes)
CREATE TABLE circuit_breaker_transitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    edge_id UUID REFERENCES service_edges(id) ON DELETE CASCADE,
    from_state VARCHAR(20) NOT NULL,
    to_state VARCHAR(20) NOT NULL,
    transition_reason VARCHAR(100) NOT NULL, -- THRESHOLD_EXCEEDED, SLEEP_WINDOW_EXPIRED, PROBE_SUCCESS, PROBE_FAILED, MANUAL_OVERRIDE
    event_micros BIGINT NOT NULL,
    failure_rate_ppm INTEGER,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cb_transitions_timeline ON circuit_breaker_transitions(world_id, event_micros DESC);
```

### Index rationale

- `idx_fault_spec_world` and `idx_exp_faults_world_status`: Fault lookup and filtering by world status is in
  the critical loop for experiment execution.
- `uq_breaker_world_service_edge`: Enforces exactly one live tracking record per edge/service per world.
- `idx_cb_transitions_timeline`: Enables fast ordered retrieval of transition logs for timeline visualization.

---

## 6. Packages

```
packages/reliability/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Barrel export of all public contracts
│   ├── core/                        # PURE STATE MACHINES (zero dependencies)
│   │   ├── circuit-breaker.ts       # CircuitBreakerCore state machine
│   │   ├── retry-policy.ts          # RetryPolicy & RetryBudget state machine
│   │   ├── bulkhead.ts              # Bulkhead admission controller
│   │   ├── deadline.ts              # DeadlineContext & propagation helper
│   │   ├── token-bucket.ts          # Integer-microsecond token bucket rate limiter
│   │   └── types.ts                 # Core configuration and event types
│   ├── faults/                      # FAULT ENGINE & SAFETY
│   │   ├── fault-spec.ts            # Fault specification parsing & validation
│   │   ├── fault-engine.ts          # Fault coordinator and active state tracker
│   │   ├── fault-types.ts           # Latency, Error, PacketDrop definitions
│   │   ├── safety-boundary.ts       # Invariant checker & auto-abort controller
│   │   └── matrix.ts                # Compatibility matrix between runtime & faults
│   └── shell/                       # NODE / FASTIFY SHELL ADAPTERS
│       ├── node-circuit-breaker.ts  # Node wrapper using globalThis timers
│       ├── fastify-breaker-plugin.ts# Fastify middleware hook for edge calls
│       └── deadline-interceptor.ts  # HTTP header parsing & injection
packages/db/
├── src/
│   ├── schema/
│   │   └── reliability.ts           # Drizzle schema matching 004_reliability.sql
│   └── migrations/
│       └── 004_reliability.sql      # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       ├── faults/
│       │   ├── fault.routes.ts      # Fastify routes under /api/v1/worlds/:worldId/faults
│       │   ├── fault.controller.ts  # Request handling & HTTP status mappings
│       │   ├── fault.service.ts     # Business logic & safety verification
│       │   ├── fault.repository.ts  # Database access via Drizzle
│       │   └── fault.schema.ts      # zod v4 schemas
│       └── breakers/
│           ├── breaker.routes.ts    # Routes under /api/v1/worlds/:worldId/breakers
│           ├── breaker.controller.ts# State retrieval & manual trip/reset
│           ├── breaker.service.ts   # Breaker audit and transition recording
│           └── breaker.schema.ts    # zod schemas
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               ├── faults/
│               │   └── page.tsx     # Fault injection matrix & safety status screen
│               └── breakers/
│                   └── page.tsx     # Circuit breaker live monitoring & control screen
```

---

## 7. Interfaces

### Core Circuit Breaker Interface

```typescript
// packages/reliability/src/core/circuit-breaker.ts

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  readonly failureRateThresholdPpm: number; // e.g. 500,000 = 50%
  readonly volumeThreshold: number; // minimum requests before evaluation
  readonly sleepWindowMicros: bigint; // wait time in OPEN before HALF_OPEN
  readonly halfOpenMaxConcurrent: number; // allowed trial requests in HALF_OPEN
  readonly consecutiveSuccessThreshold: number; // required to re-close circuit
  readonly windowBucketCount: number; // e.g. 10 buckets
  readonly bucketDurationMicros: bigint; // e.g. 1_000_000n (1 second)
}

export type AdmissionResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: 'CIRCUIT_OPEN' | 'HALF_OPEN_CONCURRENCY_EXCEEDED' };

export interface CircuitBreakerTransition {
  readonly from: CircuitState;
  readonly to: CircuitState;
  readonly reason: string;
  readonly atMicros: bigint;
  readonly failureRatePpm: number;
}

export interface CircuitBreakerCore {
  readonly state: CircuitState;
  readonly failureRatePpm: number;
  readonly consecutiveFailures: number;
  readonly consecutiveSuccesses: number;

  /** Try to admit a request through the breaker at time nowMicros */
  tryAcquire(nowMicros: bigint): AdmissionResult;

  /** Record a completed request outcome */
  recordSuccess(nowMicros: bigint): readonly CircuitBreakerTransition[];
  recordFailure(nowMicros: bigint): readonly CircuitBreakerTransition[];

  /** Manual overrides for operator intervention */
  trip(nowMicros: bigint, reason: string): CircuitBreakerTransition;
  reset(nowMicros: bigint): CircuitBreakerTransition;
}
```

### Core Retry Policy & Budget Interface

```typescript
// packages/reliability/src/core/retry-policy.ts

export interface RetryBudgetConfig {
  readonly ttlMicros: bigint; // rolling window duration
  readonly minRetriesPerSec: number; // baseline minimum allowance
  readonly retryRatio: number; // e.g. 0.10 for max 10% retries
}

export interface RetryPolicyConfig {
  readonly maxAttempts: number; // e.g. 3
  readonly baseBackoffMicros: bigint; // e.g. 50_000n (50ms)
  readonly maxBackoffMicros: bigint; // e.g. 2_000_000n (2s)
  readonly backoffJitter: 'FULL' | 'DECORRELATED' | 'NONE';
  readonly retryableStatusCodes: ReadonlySet<number>; // e.g. [502, 503, 504]
  readonly budget?: RetryBudgetConfig;
}

export type RetryDecision =
  | {
      readonly shouldRetry: false;
      readonly reason: 'MAX_ATTEMPTS' | 'NOT_RETRYABLE' | 'BUDGET_EXHAUSTED' | 'DEADLINE_EXCEEDED';
    }
  | { readonly shouldRetry: true; readonly backoffMicros: bigint };

export interface RetryBudgetCore {
  recordSuccess(nowMicros: bigint): void;
  recordFailure(nowMicros: bigint): void;
  canRetry(nowMicros: bigint): boolean;
  recordRetry(nowMicros: bigint): void;
}
```

### Fault Engine & Safety Interface

```typescript
// packages/reliability/src/faults/fault-engine.ts

export type FaultType =
  | 'LATENCY'
  | 'ERROR'
  | 'PACKET_DROP'
  | 'JITTER'
  | 'BLACKHOLE'
  | 'BANDWIDTH_LIMIT'
  | 'CORRUPT_PAYLOAD'
  | 'SERVICE_KILL';

export interface BaseFaultParams {
  readonly percentage: number; // 1 to 100
}

export interface LatencyFaultParams extends BaseFaultParams {
  readonly latencyMicros: bigint;
  readonly jitterMicros: bigint;
  readonly distribution: 'FIXED' | 'NORMAL' | 'PARETO';
}

export interface ErrorFaultParams extends BaseFaultParams {
  readonly httpStatus: number;
  readonly errorCode: string;
}

export interface FaultSpec {
  readonly id: string;
  readonly worldId: string;
  readonly faultType: FaultType;
  readonly targetServiceId?: string;
  readonly targetEdgeId?: string;
  readonly params: LatencyFaultParams | ErrorFaultParams | BaseFaultParams;
  readonly safetyRules: {
    readonly maxDurationMicros: bigint;
    readonly autoAbortOnBurnRate: boolean;
  };
}

export interface ChaosSafetyBoundary {
  evaluateSafety(
    worldId: string,
    currentErrorRatePpm: number,
    nowMicros: bigint,
  ): {
    readonly safe: boolean;
    readonly abortTriggered: boolean;
    readonly reason?: string;
  };
  triggerEmergencyAbort(worldId: string, reason: string): Promise<void>;
}
```

---

## 8. API

All routes registered under `/api/v1/worlds/:worldId` in `apps/control`.

### 1. Create Fault Specification

- `POST /api/v1/worlds/:worldId/faults`
- **Request Body (zod schema):**
  ```typescript
  export const createFaultSpecSchema = z.object({
    name: z.string().min(1).max(120),
    description: z.string().optional(),
    faultType: z.enum([
      'LATENCY',
      'ERROR',
      'PACKET_DROP',
      'JITTER',
      'BLACKHOLE',
      'BANDWIDTH_LIMIT',
      'CORRUPT_PAYLOAD',
      'SERVICE_KILL',
    ]),
    targetServiceId: z.string().uuid().optional(),
    targetEdgeId: z.string().uuid().optional(),
    parameters: z.record(z.unknown()),
    safetyRules: z
      .object({
        maxDurationMicros: z.number().int().positive().default(300_000_000), // 5 min
        autoAbortOnBurnRate: z.boolean().default(true),
      })
      .default({}),
  });
  ```
- **Response:** `201 Created` with created fault object.

### 2. List Faults for World

- `GET /api/v1/worlds/:worldId/faults`
- **Query Params:** `status?: string`, `targetServiceId?: string`
- **Response:** `200 OK` with `{ data: FaultSpec[] }`.

### 3. Inject / Trigger Fault

- `POST /api/v1/worlds/:worldId/faults/:faultId/inject`
- **Request Body:** `{ durationMicros: number }`
- **Response:** `200 OK` with `{ executionId: string, status: 'ACTIVE', startMicros: string }`.

### 4. Disarm / Stop Fault

- `POST /api/v1/worlds/:worldId/faults/:faultId/disarm`
- **Response:** `200 OK` with `{ status: 'ABORTED', endMicros: string }`.

### 5. Get Circuit Breakers

- `GET /api/v1/worlds/:worldId/breakers`
- **Response:** `200 OK` with list of breaker states across all edges.

### 6. Emergency Chaos Abort

- `POST /api/v1/worlds/:worldId/chaos/abort`
- **Request Body:** `{ reason: string }`
- **Response:** `200 OK` with `{ abortedFaultCount: number, resetBreakerCount: number }`.

---

## 9. UI

### 1. Circuit Breaker Inspector (`apps/web/src/app/worlds/[worldId]/breakers/page.tsx`)

- **Spec alignment:** §52 (Reliability Controls), §64 (Circuit Breaker Visualizer).
- **Layout:**
  - Header: World name, active breakers summary badge count (`N CLOSED`, `N OPEN`, `N HALF_OPEN`).
  - Edge table: Source Service -> Target Service, Current State badge (Green CLOSED, Red OPEN, Amber HALF_OPEN),
    Rolling Failure Rate bar meter (with PPM readout), Total volume, Actions.
  - Action buttons per edge: `Trip (Force Open)`, `Reset (Force Close)`.
  - Sliding window telemetry graph: Failure rate vs time over the last 60 seconds.

### 2. Fault Injection Console (`apps/web/src/app/worlds/[worldId]/faults/page.tsx`)

- **Spec alignment:** §53 (Chaos Engineering Console), §54 (Safety Interlocks).
- **Layout:**
  - Top Banner: **GLOBAL EMERGENCY CHAOS ABORT** button (Prominent red alert styling).
  - Safety Boundary indicator: Current blast radius (% of edges affected), World Error Rate meter, Auto-abort status indicator.
  - Active Faults drawer: List of currently running faults with countdown timers.
  - Fault Matrix Grid: Visual matrix of services and edges with quick-inject buttons (e.g. `+200ms Latency`, `503 Error`, `Drop 10%`).
  - New Fault Modal: Configurable parameters with input validation (min/max limits enforced).

---

## 10. Steps

1. **Create `packages/reliability` package:**
   Initialize `packages/reliability/package.json` and `tsconfig.json`. Ensure zero external dependencies.
2. **Implement `CircuitBreakerCore`:**
   Write `src/core/circuit-breaker.ts` pure state machine with sliding window fixed-bucket failure counter.
3. **Implement `RetryPolicy` and `RetryBudgetCore`:**
   Write `src/core/retry-policy.ts` with exponential backoff, jitter calculation via deterministic seed, and budget cap.
4. **Implement `Bulkhead` and `DeadlineContext`:**
   Write `src/core/bulkhead.ts` and `src/core/deadline.ts`.
5. **Implement `TokenBucket` rate limiter:**
   Write `src/core/token-bucket.ts` using integer micro-tokens without float accumulation.
6. **Implement Fault Engine definitions:**
   Write `src/faults/fault-types.ts` and `src/faults/fault-engine.ts`.
7. **Implement Chaos Safety Boundary:**
   Write `src/faults/safety-boundary.ts` with blast-radius limits and auto-abort evaluation.
8. **Write Shell adapters:**
   Write `src/shell/node-circuit-breaker.ts` and `src/shell/fastify-breaker-plugin.ts` for Node/Fastify execution.
9. **Database migration `004_reliability.sql`:**
   Add SQL migration and Drizzle schema in `packages/db`.
10. **Build Control Plane modules:**
    Add `apps/control/src/modules/faults` and `apps/control/src/modules/breakers`.
11. **Build Web UI:**
    Create `apps/web/src/app/worlds/[worldId]/breakers/page.tsx` and `faults/page.tsx`.
12. **Create Verification Gate script:**
    Implement `npm run verify:m4` testing all 5 core gate assertions.

---

## 11. Testing

### Unit tests (`packages/reliability/tests/unit`)

- `circuit-breaker.test.ts`:
  - Assert CLOSED -> OPEN when failure rate exceeds threshold after volume threshold.
  - Assert OPEN rejects calls without advancing downstream counters.
  - Assert OPEN transitions to HALF_OPEN after `sleepWindowMicros`.
  - Assert HALF_OPEN permits only `halfOpenMaxConcurrent` calls simultaneously.
  - Assert HALF_OPEN re-opens on a single trial failure, or closes on `consecutiveSuccessThreshold`.
- `retry-policy.test.ts`:
  - Assert backoff adheres to exponential upper bound.
  - Assert retry budget cuts off retries when retry ratio exceeds 10%.
  - Assert non-retryable status codes (e.g. 400, 404) are never retried.
- `bulkhead.test.ts`:
  - Assert calls exceeding `maxConcurrent` enter queue.
  - Assert calls exceeding `maxConcurrent + maxQueueCapacity` are immediately rejected.
- `safety-boundary.test.ts`:
  - Assert world error rate > 50% triggers auto-abort.
  - Assert blast radius limit blocks new fault injection when cap is reached.

### Integration tests (`apps/control/tests/integration/faults`)

- Test CRUD operations on `/api/v1/worlds/:worldId/faults`.
- Test fault injection and immediate disarm lifecycle.
- Test emergency chaos abort resets all active faults and records audit event.

---

## 12. Gate

Command: `npm run verify:m4`

The gate test runs unattended in CI and verifies these 5 explicit assertions:

```typescript
// tests/gates/verify-m4.ts

// Assertion 1: Circuit breaker state machine transitions deterministically
// Verified: CLOSED -> OPEN -> HALF_OPEN -> CLOSED and CLOSED -> OPEN -> HALF_OPEN -> OPEN
assert(cbTestPasses, 'Assertion 1: Circuit breaker transitions follow formal state machine');

// Assertion 2: Retry budget strictly prevents retry amplification storms
// Verified: Under 100% downstream failure, retries do not exceed configured budget ratio (10%)
assert(retryBudgetEnforced, 'Assertion 2: Retry budget limits retry amplification');

// Assertion 3: Deadline expiration sheds requests preemptively
// Verified: Requests with mg-deadline-at in the past are dropped with 0 downstream calls made
assert(deadlineEnforced, 'Assertion 3: Past deadlines shed without invoking downstream');

// Assertion 4: Fault injection accurately alters traffic behavior
// Verified: Active 100ms latency fault shifts observed P50 by exactly 100ms +/- 2ms
assert(faultObserved, 'Assertion 4: Fault injection reflects in observed latency');

// Assertion 5: Chaos Safety Boundary triggers emergency auto-abort on SLO burn
// Verified: When simulated error rate reaches 60%, safety boundary terminates all active faults within 1 tick
assert(autoAbortFires, 'Assertion 5: Chaos safety boundary triggers emergency auto-abort');
```

---

## 13. Pitfalls

1. **Using floating-point math for failure rates:** Floating-point numbers accumulate rounding errors.
   Always use parts-per-million (`ppm`: 0 to 1,000,000) or exact rational integers for error rates.
2. **Calling `Date.now()` inside `packages/reliability/src/core`:** Breaks the deterministic logical
   runtime completely. ESLint `no-restricted-globals` must forbid `Date` and `Math.random` inside `core/`.
3. **Thundering herd on circuit breaker half-open:** If 1,000 waiting requests are released simultaneously
   into a struggling service when the sleep window expires, it collapses instantly. Strictly limit
   `halfOpenMaxConcurrent` to 1 or 2 requests.
4. **Retrying without backoff jitter:** Fixed-interval retries cause phase-locking and thundering herds.
   Jitter is mandatory on every retry calculation.
5. **Failing to clean up faults on process termination:** A crash in the test runner or simulation driver
   must not leave live container interceptors or mock drops in place. All faults must have leases with
   hard max duration.

---

## 14. Done

- [ ] `packages/reliability` compiles under strict TypeScript with 0 external runtime dependencies.
- [ ] Core primitives (`CircuitBreakerCore`, `RetryPolicy`, `RetryBudget`, `Bulkhead`, `DeadlineContext`, `TokenBucket`) pass 100% unit tests.
- [ ] Migration `004_reliability.sql` applied cleanly in Postgres.
- [ ] Control API endpoints for faults and breakers tested and functional.
- [ ] UI screens for Circuit Breakers and Chaos Faults rendered with real API integration.
- [ ] `npm run verify:m4` runs green in CI with all 5 gate assertions passing.
