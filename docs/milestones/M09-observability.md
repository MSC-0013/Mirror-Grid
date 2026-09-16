# M09 — Observability: Metrics, Distributed Tracing, and Correlation

## 1. Context

In a distributed systems reliability laboratory, observability is not merely an operational feature;
it is the primary scientific apparatus. When a fault is injected into a 5-tier microservice architecture,
an engineer must be able to visually trace the exact path of the failure: which RPC first experienced
latency, how the thread pool queue grew, the exact microsecond the circuit breaker tripped, and how
the subsequent requests were shed.

MIRRORGRID unifies the **Three Pillars of Observability**:

1. **High-Precision Structured Metrics:** Prometheus-compatible `/metrics` exporter tracking request rates,
   error distributions, active concurrency, and HDR-histogram latency percentiles (P50, P90, P99, P99.9).
2. **Distributed Tracing (W3C Trace Context):** OpenTelemetry integration propagating `traceparent`
   and `tracestate` across HTTP and gRPC boundaries, with span export via OTLP and an embedded
   waterfall visualizer.
3. **Correlated Structured Logging:** Structured JSON logs correlated via `trace_id` and `span_id`,
   enabling one-click jump from a failed trace span directly to the container log lines that caused it.

Crucially, MIRRORGRID supports **dual-mode observability**: it can export to standard external backends
(Prometheus, Jaeger, Grafana, OpenTelemetry Collector) via `--profile full`, but it also includes an
embedded Postgres trace/metric store so the entire observability suite functions with **zero external
infrastructure** in lightweight `--profile core` mode.

---

## 2. Prerequisites

- M05 green (`verify:flagship` — Tier 1 core completed)
- M08 green (`verify:events` — event streaming)
- Docker Compose profile: `--profile core` (Standalone in-DB tracing) or `--profile full` (Prometheus & Jaeger)

---

## 3. Scope

### In scope

- `packages/observability`: Core OpenTelemetry SDK setup, W3C trace context injector/extractor,
  Prometheus metric registry, and Pino logger correlation bindings using Node.js `AsyncLocalStorage`.
- Fastify plugin exposing standard Prometheus `/metrics` endpoint with process, HTTP, and domain metrics.
- Standalone Span Store in PostgreSQL (`trace_spans` table) supporting offline trace visualization without Jaeger.
- Distributed Trace Waterfall viewer in Web UI (`apps/web/src/app/worlds/[worldId]/traces/[traceId]/page.tsx`):
  visual span hierarchy, latency waterfall bars, error highlights, and span attribute inspector (§65).
- Integrated Log Correlation: clicking a span displays associated JSON logs filtered by `trace_id` and `span_id`.
- Database migration `010_observability.sql`: `trace_spans` and `metrics_snapshots`.
- Automated gate script `npm run verify:observability`: 5 assertions certifying the telemetry pipeline.

### Explicitly out of scope

- Continuous profiling agents (e.g. Parca, Pyroscope).
- Third-party SaaS APM integrations (Datadog, New Relic).
- eBPF kernel network probe instrumentation.

---

## 4. Design

### Context Propagation via `AsyncLocalStorage` and W3C TraceContext

Node.js asynchronous call chains lose execution context across callbacks and promises unless explicitly tracked.
MIRRORGRID utilizes Node.js `AsyncLocalStorage`:

```typescript
// packages/observability/src/tracing/context.ts
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: number;
  readonly deadlineAtMicros?: bigint;
}

export const traceStorage = new AsyncLocalStorage<TraceContext>();
```

1. **Inbound HTTP:** Fastify middleware extracts `traceparent: 00-<traceId>-<spanId>-<flags>`.
   If missing, a fresh 128-bit `traceId` is generated.
2. **Context Scope:** The request handler runs inside `traceStorage.run(context, ...)`.
3. **Outbound RPC:** The HTTP client fetches `traceStorage.getStore()`, creates a child `spanId`,
   and injects headers:
   - `traceparent: 00-<traceId>-<childSpanId>-01`
   - `mg-deadline-at: <deadlineMicros>`
4. **Structured Logging:** Pino logger automatically attaches `trace_id` and `span_id` to every log entry.

### Standalone Span Store vs External Jaeger

To ensure the repository has zero friction on developer laptops where Docker or Jaeger might not be running:

```
+-----------------------------------------------------------------------+
|                         OpenTelemetry Tracer                          |
+-----------------------------------------------------------------------+
                                   |
              +--------------------+--------------------+
              |                                         |
   (If OTEL_EXPORTER_OTLP_ENDPOINT set)         (Always enabled)
              |                                         |
              v                                         v
+---------------------------+             +---------------------------+
|    OTLP gRPC Exporter     |             |    Postgres Span Store    |
|   -> Jaeger / Collector   |             |   -> trace_spans table    |
+---------------------------+             +---------------------------+
```

The Web UI queries `/api/v1/worlds/:worldId/traces/:traceId`, which reads directly from Postgres.
If Jaeger is running, operators can also use the native Jaeger UI; if not, the system is 100% self-contained.

### High Dynamic Range (HDR) Latency Histograms

Standard Prometheus client summaries suffer from high memory consumption or loss of tail precision.
MIRRORGRID implements exponential bucket histograms:

- Explicit boundaries: `[1ms, 5ms, 10ms, 25ms, 50ms, 100ms, 250ms, 500ms, 1000ms, 2500ms, 5000ms, 10000ms]`.
- Separate label dimensions for `world_id`, `service_id`, `edge_id`, and `status_code`.
- Strict anti-cardinality rules: user IDs, email addresses, and dynamic query params are **never** included
  in metric labels, preventing memory explosion.

### Trace Waterfall Visualizer Algorithm

When spans are ingested, they arrive out-of-order. The visualizer reconstructs the tree:

1. Identify the root span (where `parent_span_id IS NULL`).
2. Build child arrays by matching `parent_span_id == span_id`.
3. Calculate relative start offsets:
   $$\text{offsetPercent} = \frac{\text{span.startTime} - \text{root.startTime}}{\text{root.duration}} \times 100$$
4. Calculate duration width:
   $$\text{widthPercent} = \frac{\text{span.duration}}{\text{root.duration}} \times 100$$
5. Highlight the **Critical Path** (the sequence of dependent spans that directly determines total latency).

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/010_observability.sql`:

```sql
-- 010_observability.sql: Distributed trace spans and time-series metrics snapshots

-- 1. Distributed Trace Spans table
CREATE TABLE trace_spans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    trace_id VARCHAR(32) NOT NULL,          -- Hex-encoded 128-bit trace ID
    span_id VARCHAR(16) NOT NULL,           -- Hex-encoded 64-bit span ID
    parent_span_id VARCHAR(16),             -- NULL for root spans
    service_id UUID REFERENCES services(id) ON DELETE SET NULL,
    service_name VARCHAR(120) NOT NULL,
    operation_name VARCHAR(255) NOT NULL,
    span_kind VARCHAR(30) NOT NULL DEFAULT 'INTERNAL', -- SERVER, CLIENT, PRODUCER, CONSUMER, INTERNAL
    start_time_micros BIGINT NOT NULL,      -- Microsecond timestamp
    duration_micros BIGINT NOT NULL,
    status_code VARCHAR(20) NOT NULL DEFAULT 'OK', -- OK, ERROR, UNSET
    status_message TEXT,
    attributes JSONB NOT NULL DEFAULT '{}'::jsonb, -- HTTP status, URL, peer address, breaker state
    events JSONB NOT NULL DEFAULT '[]'::jsonb,      -- Point-in-time span annotations/exceptions
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_spans_trace ON trace_spans(trace_id, start_time_micros ASC);
CREATE INDEX idx_spans_world_time ON trace_spans(world_id, start_time_micros DESC);
CREATE INDEX idx_spans_service ON trace_spans(service_name, start_time_micros DESC);
CREATE INDEX idx_spans_error ON trace_spans(world_id, status_code) WHERE status_code = 'ERROR';

-- 2. Aggregated Metrics Snapshots (Historical rollups)
CREATE TABLE metrics_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    service_id UUID REFERENCES services(id) ON DELETE CASCADE,
    metric_timestamp TIMESTAMPTZ NOT NULL,
    metric_name VARCHAR(120) NOT NULL,
    labels JSONB NOT NULL DEFAULT '{}'::jsonb,
    value_count BIGINT NOT NULL,
    value_sum NUMERIC(16, 4) NOT NULL,
    p50_ms NUMERIC(10, 3),
    p95_ms NUMERIC(10, 3),
    p99_ms NUMERIC(10, 3),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_metrics_query ON metrics_snapshots(world_id, service_id, metric_name, metric_timestamp DESC);
```

### Index rationale

- `idx_spans_trace`: Assembles the full distributed trace waterfall in a single, perfectly indexed query.
- `idx_spans_error`: Partial index enabling instantaneous filtering of all failed traces in a world.

---

## 6. Packages

```
packages/observability/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public telemetry API
│   ├── tracing/
│   │   ├── tracer.ts                # OpenTelemetry Tracer wrapper
│   │   ├── context.ts               # AsyncLocalStorage context holder
│   │   ├── w3c.ts                   # traceparent parser and serializer
│   │   └── span-collector.ts        # Postgres batch span flusher
│   ├── metrics/
│   │   ├── registry.ts              # Prometheus MetricRegistry singleton
│   │   ├── histogram.ts             # HDR latency histogram
│   │   └── standard-metrics.ts      # HTTP, circuit breaker, and system gauges
│   └── logging/
│       ├── pino-logger.ts           # Trace-correlated JSON logger
│       └── serializers.ts           # Error and HTTP request serializers
packages/db/
├── src/
│   ├── schema/
│   │   └── observability.ts         # Drizzle schema matching 010_observability.sql
│   └── migrations/
│       └── 010_observability.sql    # Migration DDL above
apps/control/
├── src/
│   ├── plugins/
│   │   ├── metrics.plugin.ts        # Exposes GET /metrics
│   │   └── tracing.plugin.ts        # Inbound trace extraction and span creation
│   └── modules/
│       └── traces/
│           ├── trace.routes.ts      # GET /api/v1/worlds/:worldId/traces
│           ├── trace.controller.ts
│           ├── trace.service.ts     # Waterfall tree builder & critical path logic
│           └── trace.repository.ts
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               ├── traces/
│               │   ├── page.tsx     # Trace search & filter catalog (§65)
│               │   └── [traceId]/
│               │       └── page.tsx # Distributed Trace Waterfall Visualizer (§65)
│               └── metrics/
│                   └── page.tsx     # Metrics Explorer & Time-Series Graphs (§66)
```

---

## 7. Interfaces

### Trace Span and Waterfall Tree Types

```typescript
// packages/observability/src/tracing/tracer.ts

export interface SpanAttributes {
  readonly [key: string]: string | number | boolean | undefined;
}

export interface SpanData {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly serviceName: string;
  readonly operationName: string;
  readonly startTimeMicros: bigint;
  readonly durationMicros: bigint;
  readonly statusCode: 'OK' | 'ERROR' | 'UNSET';
  readonly statusMessage?: string;
  readonly attributes: SpanAttributes;
}

export interface TraceWaterfallNode extends SpanData {
  readonly depth: number;
  readonly offsetPercent: number;
  readonly widthPercent: number;
  readonly isCriticalPath: boolean;
  readonly children: readonly TraceWaterfallNode[];
}

export interface TraceDetail {
  readonly traceId: string;
  readonly totalDurationMicros: bigint;
  readonly spanCount: number;
  readonly serviceCount: number;
  readonly rootSpan: TraceWaterfallNode;
  readonly hasError: boolean;
}
```

### Metrics Exporter Contract

```typescript
// packages/observability/src/metrics/registry.ts

export interface MetricLabels {
  readonly [key: string]: string;
}

export interface MetricRegistry {
  incrementCounter(name: string, value?: number, labels?: MetricLabels): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  recordHistogram(name: string, valueMs: number, labels?: MetricLabels): void;
  exportPrometheus(): Promise<string>;
}
```

---

## 8. API

### 1. Prometheus Scrape Endpoint

- `GET /metrics`
- **Response:** `200 OK` (`text/plain; version=0.0.4; charset=utf-8`)
- Conforms to Prometheus openmetrics specification.

### 2. Query Traces for World

- `GET /api/v1/worlds/:worldId/traces`
- **Query Params:** `minDurationMs=100&hasError=true&serviceName=orders&limit=25`
- **Response:** `200 OK` with `{ data: TraceSummary[] }`.

### 3. Get Trace Waterfall Detail

- `GET /api/v1/worlds/:worldId/traces/:traceId`
- **Response:** `200 OK` with full `TraceDetail` tree including offsets and critical path flags.

### 4. Query Correlated Logs for Span

- `GET /api/v1/worlds/:worldId/traces/:traceId/spans/:spanId/logs`
- **Response:** `200 OK` with array of JSON log lines matching the trace and span IDs.

---

## 9. UI

### 1. Distributed Trace Waterfall Visualizer (`apps/web/src/app/worlds/[worldId]/traces/[traceId]/page.tsx`)

- **Spec alignment:** §65 (Distributed Trace Waterfall Viewer).
- **Layout:**
  - **Trace Overview Banner:**
    - Trace ID, Root Operation (`POST /orders/checkout`), Total Duration (`428ms`), Span Count (`14`),
      Services Involved (`4`), Error Status Badge (Red `FAILED` or Green `SUCCESS`).
  - **Timeline Header:** Microsecond ruler (`0ms`, `100ms`, `200ms`, `300ms`, `400ms`).
  - **Waterfall Tree View:**
    - Left column: Service name pill (color-coded per service) and operation name with collapsible tree arrows.
    - Right column: Gantt-chart timeline bars. Bars are color-coded:
      - Blue: Normal execution.
      - Red: Errored span (e.g. 504 Gateway Timeout or Breaker Open).
      - Amber outline: Critical Path indicator.
  - **Span Details Drawer (Side Sheet):**
    - Clicking any bar slides open detailed metadata:
      - Exact timestamps, duration in microseconds.
      - Attributes table: `http.status_code: 504`, `circuit_breaker.state: OPEN`, `retry.attempt: 3`.
      - **"Correlated Logs" Tab:** Embedded terminal showing container logs emitted during that span's exact window.

### 2. Metrics Explorer (`apps/web/src/app/worlds/[worldId]/metrics/page.tsx`)

- **Spec alignment:** §66 (Prometheus Metrics & SLI Dashboard).
- **Layout:**
  - Time range selector (`Last 5m`, `15m`, `1h`, `Custom`).
  - Grid of charts: RPS per service, P50/P95/P99 latency curves, Error rate %, and Bulkhead queue depth.

---

## 10. Steps

1. **Create `packages/observability` package:** Setup OpenTelemetry dependencies, Pino, and tsconfig.
2. **Implement W3C TraceContext propagator:** Build `src/tracing/w3c.ts` for `traceparent` parsing and generation.
3. **Implement AsyncLocalStorage Context Manager:** Build `src/tracing/context.ts` for ambient context tracking.
4. **Implement Trace-Correlated Pino Logger:** Ensure all application logs automatically include `trace_id` and `span_id`.
5. **Implement Prometheus Metric Registry:** Build metric collectors for counters, gauges, and HDR histograms.
6. **Implement Fastify Metrics Plugin:** Expose standard `/metrics` endpoint with process and HTTP metrics.
7. **Database migration `010_observability.sql`:** Add tables for `trace_spans` and `metrics_snapshots`.
8. **Build In-Database Span Ingestion:** Implement batch span flusher in `packages/observability`.
9. **Build Waterfall Tree Builder:** Implement algorithm in `apps/control` that constructs hierarchical span trees.
10. **Build Trace Waterfall UI:** Implement Next.js waterfall visualizer in `apps/web/src/app/worlds/[worldId]/traces/[traceId]/page.tsx`.
11. **Connect Synthetic Service to Tracing:** Ensure `apps/synthetic-service` creates spans for downstream calls.
12. **Implement `npm run verify:observability` gate script:** Automated verification suite validating the telemetry pipeline.

---

## 11. Testing

### Unit tests (`packages/observability/tests/unit`)

- `w3c.test.ts`: Verify strict parsing of standard W3C `traceparent` headers and generation of valid child headers.
- `histogram.test.ts`: Verify HDR histogram percentiles (P50, P99) under simulated sample distributions.
- `waterfall-builder.test.ts`: Reconstruct a 10-span tree from shuffled arrays and assert tree hierarchy and critical path.

### Integration tests (`apps/control/tests/integration/observability`)

- `trace-propagation.test.ts`:
  - Send HTTP request through Gateway -> Service A -> Service B.
  - Assert all 3 services record spans sharing identical `traceId` with proper parent-child relationships in Postgres.
- `metrics-scrape.test.ts`:
  - Execute 50 requests; scrape `GET /metrics`.
  - Assert standard Prometheus text format parses cleanly with zero syntax errors.

---

## 12. Gate

Command: `npm run verify:observability`

The gate test validates these 5 observability assertions:

```typescript
// tests/gates/verify-observability.ts

// Assertion 1: Trace context unbroken across 4-hop distributed call chain
assert(traceSpansChainVerified, 'Assertion 1: Traceparent propagated cleanly across all 4 hops');

// Assertion 2: GET /metrics complies strictly with Prometheus exposition format
assert(
  prometheusFormatValid,
  'Assertion 2: Prometheus /metrics format passes strict syntax validation',
);

// Assertion 3: Structured logs correlate 100% with trace_id and span_id
assert(logsCorrelatedToSpan, 'Assertion 3: Log lines contain matching traceId and spanId');

// Assertion 4: Waterfall tree accurately identifies the critical path and latency offset
assert(
  waterfallCriticalPathCalculated,
  'Assertion 4: Trace waterfall accurately calculates critical path',
);

// Assertion 5: Standalone Postgres span store operates without external Jaeger
assert(
  standaloneTracingFunctional,
  'Assertion 5: Complete trace visualizer operates from Postgres store',
);
```

---

## 13. Pitfalls

1. **High-cardinality label explosions:** Adding `userId`, `orderId`, or high-cardinality strings to Prometheus
   metric labels will exhaust server memory in minutes. Keep metric labels strictly bounded to static enums.
2. **Context loss across `setTimeout` or EventEmitter:** Node's `AsyncLocalStorage` can lose context if
   custom event emitters or third-party libraries do not maintain async hooks. Wrap asynchronous boundaries.
3. **Clock skew across Docker containers:** If containers have desynchronized system clocks, child spans
   can appear to start _before_ their parent spans. Use monotonic duration offsets calculated from relative start.
4. **Synchronous span writes blocking business traffic:** Spans must be buffered in memory and flushed
   asynchronously in batches. Never perform a synchronous DB insert in the critical path of an RPC.

---

## 14. Done

- [ ] `packages/observability` compiles under strict TypeScript with 0 errors.
- [ ] W3C TraceContext propagated across all HTTP and synthetic service boundaries.
- [ ] Prometheus `/metrics` endpoint active and compliant with openmetrics standards.
- [ ] Structured Pino logger correlates all logs with `trace_id` and `span_id`.
- [ ] Migration `010_observability.sql` applied cleanly in Postgres.
- [ ] Distributed Trace Waterfall visualizer live in Web UI with critical path highlighting.
- [ ] Standalone mode confirmed working with zero external Jaeger/Prometheus requirement.
- [ ] `npm run verify:observability` runs green in CI with all 5 gate assertions passing.
