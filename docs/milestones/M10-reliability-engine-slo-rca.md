# M10 — Reliability Engine: SLOs, Error Budgets, and Automated RCA

## 1. Context

Engineering organizations do not manage systems by staring at raw metrics; they manage systems via
**Service Level Objectives (SLOs)**, **Error Budgets**, and **Root Cause Analysis (RCA)**.

In M04 and M05, MIRRORGRID built the capability to inject faults and observe cascading failures.
However, raw latency spikes and 500 error counts lack business context. In real-world Site Reliability
Engineering (SRE), teams need to know:
1. Did this incident violate our customer contract (SLO)?
2. How much of our 30-day Error Budget was consumed (Burn Rate)?
3. Given that 10 services threw errors simultaneously, which single node was the **true root cause**,
   and which were merely collateral victims?

This milestone implements the **Site Reliability Engineering Intelligence Engine**:
- Formal Google SRE Error Budget calculations and Multi-Window Multi-Burn-Rate alerting.
- Deterministic graph-theoretic **Automated Root Cause Analysis (RCA)** that traces failure propagation
  through the topology graph to isolate the culprit.
- Executive Reliability Report generation (Markdown and downloadable summary) synthesizing incident
  timelines, MTTD/MTTR, and architectural recommendations.

---

## 2. Prerequisites

- M05 green (`verify:flagship` — Tier 1 core completed)
- M08 green (`verify:events` — event streaming)
- M09 green (`verify:observability` — distributed tracing and metrics)
- Docker Compose profile: `--profile core` (Postgres and Redis)

---

## 3. Scope

### In scope
- `packages/sre`: Core mathematical engine for SLI calculation, Error Budget accounting, multi-window
  burn rate evaluation, and graph-theoretic RCA algorithms.
- SLO management: Availability SLIs (% of successful requests) and Latency SLIs (% of requests faster than threshold).
- Google SRE Multi-Window Multi-Burn-Rate Alerting (14.4x 1h/5m critical burn, 6x 6h/30m high burn).
- Graph-theoretic RCA Engine: Analyzes dependency graphs, trace spans, and anomaly timestamps to isolate
  the root cause service with confidence percentage.
- Database migration `011_slo_rca.sql`: `service_slos`, `slo_burn_events`, `rca_investigations`, and `reliability_reports`.
- Executive Report Generator: Generates comprehensive Markdown reliability reviews.
- Web UI: SLO & Error Budget Dashboard (§67) and Automated RCA Incident Review console (§69).

### Explicitly out of scope
- External PagerDuty / OpsGenie / Slack notification webhook dispatching.
- Black-box neural network anomaly detection (M10 uses transparent, explainable graph algorithms).
- Customer billing or financial SLA credit calculation.

---

## 4. Design

### Google SRE Error Budget Math & Multi-Window Burn Rates

An SLO defines a target reliability over a rolling window (e.g. 99.9% over 30 days).
The **Error Budget** is the fraction of allowable unreliability:
$$\text{Error Budget} = 1.0 - \text{Target} = 1.0 - 0.999 = 0.001 \quad (0.1\%)$$

If an outage occurs, we measure how rapidly the budget is consumed (**Burn Rate**):
- $\text{Burn Rate} = 1.0$: Consumes 100% of the budget in exactly the window duration (e.g. 30 days).
- $\text{Burn Rate} = 14.4$: Consumes 2% of the budget in 1 hour. This triggers a **P1 Critical Alert**.
- $\text{Burn Rate} = 6.0$: Consumes 5% of the budget in 6 hours. This triggers a **P2 High Alert**.

To prevent alert fatigue and flapping, MIRRORGRID implements **Multi-Window Verification**:
A 14.4x alert requires **both**:
1. Long window (1 hour) burn rate $\ge 14.4$
2. Short window (5 minutes) burn rate $\ge 14.4$
The short window ensures the incident is still actively occurring when the alert fires.

### Graph-Theoretic Automated Root Cause Analysis (RCA)

When Payments slows down, Gateway throws 504, Orders throws 500, and Notifications times out.
A naive alert manager blames Gateway because Gateway has the highest raw error count.

MIRRORGRID’s RCA algorithm uses topological causality:

```
[ Gateway ] (Symptom: 504 errors)
     |
     v
[ Orders ]  (Symptom: Thread queue full)
     |
     v
[ Payments ] (ROOT CAUSE: Injected Latency +400ms)
     |
     v
[ Database ] (Healthy: Latency 2ms)
```

**The Algorithm:**
1. **Anomaly Detection:** Identify all nodes where current SLI deviates $> 3\sigma$ from baseline.
2. **Topological Ordering:** Construct the dependency subgraph containing only degraded nodes.
3. **Temporal Precedence:** Find the node whose first anomaly timestamp ($T_0$) occurred earliest.
4. **Edge Culprit Verification:** For each edge $A \to B$, calculate self-latency of $B$ vs wait-time of $A$.
   If $B$’s execution time accounts for $\ge 85\%$ of $A$’s latency, culpability shifts to $B$.
5. **Leaf Isolation:** The deepest node in the dependency graph that has internal degradation and whose
   own downstream dependencies are healthy is designated the **Root Cause**.
6. **Confidence Scoring:** Calculated based on temporal precedence margin and correlation coefficient.

### Executive Reliability Report Compiler

Reports synthesize technical chaos runs into executive insights:
- Executive Summary & Reliability Score (0–100).
- Error Budget Impact table (% consumed, time to exhaustion).
- Cascading Failure Diagram showing blast radius.
- MTTD and MTTR scorecard.
- Actionable Architectural Recommendations (e.g. *"Reduce Orders retry limit from 3 to 1 to eliminate retry storm"*).

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/011_slo_rca.sql`:

```sql
-- 011_slo_rca.sql: Service Level Objectives, Error Budgets, and Automated RCA

-- 1. Service Level Objectives table
CREATE TABLE service_slos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    sli_type VARCHAR(50) NOT NULL,          -- AVAILABILITY, LATENCY_P99, LATENCY_P95
    target_percentage NUMERIC(6, 3) NOT NULL, -- e.g. 99.900 (99.9%)
    window_seconds INTEGER NOT NULL DEFAULT 2592000, -- 30 days (or virtual duration)
    threshold_latency_micros BIGINT,        -- Required for LATENCY SLIs
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_service_slo_name UNIQUE (service_id, name)
);

CREATE INDEX idx_slos_world ON service_slos(world_id);

-- 2. SLO Burn Events and Alert Triggers
CREATE TABLE slo_burn_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slo_id UUID NOT NULL REFERENCES service_slos(id) ON DELETE CASCADE,
    burn_rate NUMERIC(8, 2) NOT NULL,
    severity VARCHAR(20) NOT NULL,          -- P1_CRITICAL, P2_HIGH, P3_WARNING
    long_window_seconds INTEGER NOT NULL,
    short_window_seconds INTEGER NOT NULL,
    budget_consumed_percent NUMERIC(6, 3) NOT NULL,
    triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ
);

CREATE INDEX idx_burn_events_slo ON slo_burn_events(slo_id, triggered_at DESC);

-- 3. Automated RCA Investigations
CREATE TABLE rca_investigations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    experiment_run_id UUID,
    root_cause_service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    confidence_percentage NUMERIC(5, 2) NOT NULL, -- e.g. 94.50%
    failure_type VARCHAR(80) NOT NULL,             -- LATENCY_INDUCED_SATURATION, RESOURCE_STARVATION, POISON_PILL
    causal_chain JSONB NOT NULL DEFAULT '[]'::jsonb, -- Array of [serviceId, edgeId, anomalyTimestamp]
    evidence_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_rca_world ON rca_investigations(world_id, created_at DESC);

-- 4. Executive Reliability Reports
CREATE TABLE reliability_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    time_range_start TIMESTAMPTZ NOT NULL,
    time_range_end TIMESTAMPTZ NOT NULL,
    overall_score NUMERIC(5, 2) NOT NULL,         -- 0 to 100
    error_budget_consumed_percent NUMERIC(6, 3) NOT NULL,
    report_markdown TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reports_world ON reliability_reports(world_id, created_at DESC);
```

### Index rationale
- `idx_slos_world`: Instant lookup of all active SLOs for world dashboard.
- `idx_burn_events_slo`: Fast retrieval of recent burn spikes for alerting status.
- `idx_rca_world`: Ordered access to forensic incident investigations.

---

## 6. Packages

```
packages/sre/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public API exports
│   ├── slo/
│   │   ├── sli-calculator.ts        # Availability & latency SLI computation
│   │   ├── error-budget.ts          # Budget consumption and projection
│   │   └── burn-rate-evaluator.ts   # Multi-window multi-burn-rate alerting logic
│   ├── rca/
│   │   ├── graph-analyzer.ts        # Dependency graph traversal
│   │   ├── temporal-precedence.ts   # Chronological anomaly ranker
│   │   └── rca-engine.ts            # Root cause synthesizer and confidence scorer
│   └── reports/
│       ├── report-compiler.ts       # Markdown executive report generator
│       └── recommendations.ts       # Architectural heuristic rule engine
packages/db/
├── src/
│   ├── schema/
│   │   └── slo.ts                   # Drizzle schema matching 011_slo_rca.sql
│   └── migrations/
│       └── 011_slo_rca.sql          # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       ├── slo/
│       │   ├── slo.routes.ts        # SLO configuration and budget queries
│       │   ├── slo.controller.ts
│       │   └── slo.service.ts
│       └── rca/
│           ├── rca.routes.ts        # Incident trigger and RCA analysis endpoints
│           ├── rca.controller.ts
│           └── rca.service.ts
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               ├── slo/
│               │   └── page.tsx     # SLO & Error Budget Dashboard (§67)
│               ├── rca/
│               │   └── page.tsx     # Automated RCA Incident Review Console (§69)
│               └── reports/
│                   └── page.tsx     # Reliability Reports Archive
```

---

## 7. Interfaces

### SLO and Burn Rate Contracts

```typescript
// packages/sre/src/slo/sli-calculator.ts

export type SliType = 'AVAILABILITY' | 'LATENCY_P99' | 'LATENCY_P95';

export interface SloConfig {
  readonly id: string;
  readonly worldId: string;
  readonly serviceId: string;
  readonly name: string;
  readonly type: SliType;
  readonly targetPercentage: number; // e.g. 99.9
  readonly windowSeconds: number;
  readonly thresholdLatencyMicros?: bigint;
}

export interface ErrorBudgetStatus {
  readonly sloId: string;
  readonly targetPercentage: number;
  readonly currentPercentage: number;
  readonly budgetRemainingPercent: number; // e.g. 42.5%
  readonly currentBurnRate: number;        // e.g. 14.4
  readonly isBurning: boolean;
  readonly estimatedExhaustionHours?: number;
}
```

### RCA Engine Contract

```typescript
// packages/sre/src/rca/rca-engine.ts

export interface CausalChainNode {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly anomalyDetectedAtMicros: bigint;
  readonly observedMetric: string;
  readonly deviationFactor: number;
}

export interface RcaInvestigationResult {
  readonly rootCauseServiceId: string;
  readonly rootCauseServiceName: string;
  readonly confidencePercentage: number;
  readonly failureType: 'LATENCY_INDUCED_SATURATION' | 'RESOURCE_STARVATION' | 'POISON_PILL' | 'CIRCUIT_TRIP_CASCADE';
  readonly causalPath: readonly CausalChainNode[];
  readonly explanation: string;
  readonly architecturalRecommendation: string;
}

export interface RcaEngine {
  analyzeIncident(worldId: string, incidentWindow: { fromMicros: bigint; toMicros: bigint }): Promise<RcaInvestigationResult>;
}
```

---

## 8. API

Routes in `apps/control` under `/api/v1/worlds/:worldId`.

### 1. Create Service SLO
- `POST /api/v1/worlds/:worldId/slos`
- **Request Body (zod schema):**
  ```typescript
  export const createSloSchema = z.object({
    serviceId: z.string().uuid(),
    name: z.string().min(1).max(120),
    sliType: z.enum(['AVAILABILITY', 'LATENCY_P99', 'LATENCY_P95']),
    targetPercentage: z.number().min(90.0).max(99.999),
    windowSeconds: z.number().int().positive().default(2592000),
    thresholdLatencyMicros: z.number().int().positive().optional(),
  });
  ```
- **Response:** `201 Created` with configured SLO.

### 2. Get Live Error Budget Status
- `GET /api/v1/worlds/:worldId/slos/:sloId/budget`
- **Response:** `200 OK` with `ErrorBudgetStatus`.

### 3. Trigger Automated RCA Analysis
- `POST /api/v1/worlds/:worldId/rca/analyze`
- **Request Body:** `{ fromMicros: number, toMicros: number, alertId?: string }`
- **Response:** `200 OK` with `RcaInvestigationResult`.

### 4. Generate Executive Reliability Report
- `POST /api/v1/worlds/:worldId/reports/generate`
- **Request Body:** `{ title: string, timeRangeStart: string, timeRangeEnd: string }`
- **Response:** `201 Created` with report summary and full Markdown body.

---

## 9. UI

### 1. SLO & Error Budget Dashboard (`apps/web/src/app/worlds/[worldId]/slo/page.tsx`)
- **Spec alignment:** §67 (SLO & Error Budget Dashboard).
- **Layout:**
  - Header: World overall reliability index score (`99.82% / 99.90% Target`).
  - Error Budget Remaining Bars: Visual progress bar per service:
    - Green (`> 50% remaining`)
    - Amber (`10% - 50% remaining`)
    - Red (`< 10% remaining` — Danger of SLO breach)
  - Live Burn Rate Alert Pills: Shows active burn rates (`14.4x CRITICAL` in pulsing red).
  - Historical Compliance Grid: 30-day compliance calendar heat map.

### 2. Automated RCA Incident Review Console (`apps/web/src/app/worlds/[worldId]/rca/page.tsx`)
- **Spec alignment:** §69 (Automated RCA Incident Review).
- **Layout:**
  - Incident Headline Banner:
    - Root Cause Identified: **Payments Service** (Confidence: **96.4%**).
    - Failure Mechanism: `LATENCY_INDUCED_SATURATION`.
  - Interactive Causal Path Visualizer: Horizontal node graph:
    `Gateway (504) ---> Orders (Thread Exhausted) ---> [ Payments (Root Cause: +400ms) ]`
    Clicking each node shows evidence cards and anomaly charts.
  - SRE Recommendations Box: Clear remediation guidance (e.g. *"Install circuit breaker on Orders -> Payments edge with 200ms timeout"*).

---

## 10. Steps

1. **Create `packages/sre` package:** Initialize directory, build configuration, and types.
2. **Implement SLI calculation algorithms:** Build pure functions for availability and percentile latency.
3. **Implement Error Budget & Burn Rate Evaluator:** Implement Google SRE multi-window burn rate math.
4. **Build Graph-Theoretic RCA Engine:** Implement topology traversal, temporal precedence ranker, and causal path constructor.
5. **Implement SRE Recommendation Rule Engine:** Build heuristic advisor based on detected failure patterns.
6. **Implement Markdown Report Compiler:** Build executive report generation engine.
7. **Database migration `011_slo_rca.sql`:** Apply schema and indexes in Postgres.
8. **Build Control Plane SLO and RCA modules:** Add Fastify routes and service handlers.
9. **Build SLO & Error Budget UI:** Implement `apps/web/src/app/worlds/[worldId]/slo/page.tsx`.
10. **Build Automated RCA UI:** Implement `apps/web/src/app/worlds/[worldId]/rca/page.tsx`.
11. **Connect Experiment Engine to SRE Engine:** Automatically trigger RCA after experiment completion.
12. **Implement `npm run verify:reliability` gate script:** Automated verification suite certifying SRE algorithms.

---

## 11. Testing

### Unit tests (`packages/sre/tests/unit`)
- `burn-rate.test.ts`:
  - Assert 2% budget consumed in 1 hour outputs exactly `burnRate = 14.4`.
  - Assert multi-window rule rejects false alarms where short window is normal.
- `rca-engine.test.ts`:
  - Simulate 5-node cascade: Gateway -> Orders -> Inventory -> Payments -> DB.
  - Inject latency on Payments.
  - Assert RCA correctly designates Payments as root cause with $> 90\%$ confidence (not Gateway).

### Integration tests (`apps/control/tests/integration/sre`)
- Create SLO, simulate metric samples exceeding threshold, assert `slo_burn_events` record inserted.
- Trigger RCA analysis via API; assert resulting report correctly maps causal chain and persists in DB.

---

## 12. Gate

Command: `npm run verify:reliability`

The gate test validates these 5 core SRE assertions:

```typescript
// tests/gates/verify-reliability.ts

// Assertion 1: Multi-window burn rate math matches Google SRE specifications exactly
assert(burnRateEvaluatorAccurate, 'Assertion 1: Multi-window burn rate calculations mathematically verified');

// Assertion 2: Dual-window requirement suppresses transient false-positive alerts
assert(transientSpikeSuppressed, 'Assertion 2: Short-lived transient spikes suppressed without alert');

// Assertion 3: Automated RCA isolates true root cause in a 4-tier cascading failure (>90% confidence)
assert(rcaResult.rootCauseServiceName === 'payments' && rcaResult.confidencePercentage >= 90.0,
  'Assertion 3: Graph RCA isolates root cause with high confidence');

// Assertion 4: Error budget accounting accurately tracks budget depletion and time-to-exhaustion
assert(errorBudgetCalculatedCorrectly, 'Assertion 4: Error budget remaining percentage accurate');

// Assertion 5: Executive report compiler generates complete, well-formed Markdown document
assert(reportMarkdownValid && reportMarkdown.includes('Root Cause Analysis'),
  'Assertion 5: Executive reliability report compiles successfully');
```

---

## 13. Pitfalls

1. **Single-window burn rate alerting:** Alerting on 1-hour window without a 5-minute short window causes
   "ghost alerts" that wake up engineers 50 minutes after an incident has already self-healed.
2. **Blaming ingress proxies in RCA:** Ingress services always show the highest volume of errors.
   RCA must subtract downstream latency before evaluating upstream culpability.
3. **Division by zero in low-volume worlds:** If a world processes zero requests during a window,
   SLI calculations must handle undefined denominators gracefully without throwing NaN.
4. **Static threshold drift:** Fixed latency thresholds fail if normal service baselines change.
   Support both percentile targets and relative deviations.

---

## 14. Done

- [ ] `packages/sre` compiles under strict TypeScript with 0 errors.
- [ ] Multi-window multi-burn-rate alerting complies with Google SRE specifications.
- [ ] Graph-theoretic RCA successfully pinpoints root cause node in simulated cascades.
- [ ] Executive report generator compiles comprehensive Markdown reports.
- [ ] Migration `011_slo_rca.sql` applied cleanly in Postgres.
- [ ] SLO Dashboard and RCA Review Console live in web UI.
- [ ] `npm run verify:reliability` runs green in CI with all 5 gate assertions passing.
