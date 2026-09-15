# M01 — Domain Model and Topology

## 1. Context

M01 gives the system its vocabulary: services, dependencies, workloads, and the graph algorithms
that power every analytical feature downstream (blast radius, critical path, RCA). It also defines
`RuntimeAdapter` — the port that M02 and M03 implement. Defining the port before either implementation
means both adapters are constrained to the same contract from the start.

The topology page (spec §19–22) is the first genuinely interactive UI in the system. Because M00
established the no-mock rule, every node and edge the user sees is a real DB row.

---

## 2. Prerequisites

- M00 gate green (`verify:m0`)
- `--profile core` (Postgres only)

---

## 3. Scope

### In scope
- Migration 002_topology.sql: services, service_instances, service_dependencies, workloads
- packages/domain: entities, state machines, transition table, graph algorithms, RuntimeAdapter port
- apps/control: services, dependencies, workloads modules (full six-file shape each)
- apps/web: topology page, node/edge design, service drawer, service page

### Explicitly out of scope
- RuntimeAdapter implementations (M02 = LogicalRuntimeAdapter, M03 = ContainerRuntimeAdapter)
- Simulation engine (M2)
- Fault injection (M4)
- Any edge-policy enforcement (policies are stored here; they are consumed in M2)

---

## 4. Design

### State machines as data, not Postgres enums

WorldStatus and ServiceStatus are `TEXT` columns with `CHECK` constraints, plus a transition table
in `packages/domain`. A Postgres `ENUM` requires a migration to extend and cannot express which
transitions are legal. The transition table rejects `COMPLETED -> RUNNING` in application code;
the CHECK constraint catches anything that slips past the application layer.

**Rejected:** Postgres ENUMs — migration overhead, cannot encode transition rules.

### Cycle detection at write time

A cyclic dependency graph makes the simulation non-terminating. The API rejects any edge that
would create a cycle with a 422 response naming the cycle path. This is simpler than detecting
cycles at run time and gives the user actionable information immediately.

### Hierarchical layout (dagre)

React Flow uses the dagre layout algorithm for the topology view. Dagre is deterministic given
the same graph — so a World's topology looks the same every time it is opened, which matters for
visual continuity across sessions.

### Edge policies as first-class data

Service dependency edges carry `timeout_ms`, `retry_policy` (type, max_attempts, backoff),
`criticality`, `circuit_breaker_policy`. These are not display metadata — M2's simulation engine
reads them directly. Defining them here means M2 has real, varied data to run on from day one.

### RuntimeAdapter port (defined here, implemented in M02/M03)

The interface is defined in `packages/domain` rather than in either app because it is a domain
contract: it describes what a runtime must be able to do, not how any specific runtime does it.
See section 7 for the full signature.

---

## 5. Data Model

### Migration 002_topology.sql

```sql
-- Services
CREATE TABLE services (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  service_type    TEXT NOT NULL DEFAULT 'HTTP'
                  CHECK (service_type IN ('HTTP','GRPC','WORKER','DATABASE','CACHE','MESSAGE_BROKER')),
  status          TEXT NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  target_instances INT NOT NULL DEFAULT 1 CHECK (target_instances >= 1 AND target_instances <= 100),
  concurrency_limit INT NOT NULL DEFAULT 64 CHECK (concurrency_limit >= 1),
  queue_capacity  INT NOT NULL DEFAULT 1000 CHECK (queue_capacity >= 0),
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(world_id, name)
);

CREATE INDEX services_world_status_idx ON services (world_id, status);

-- Service instances
CREATE TABLE service_instances (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  instance_index  INT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'STOPPED'
                  CHECK (status IN ('STOPPED','STARTING','HEALTHY','DEGRADED',
                                    'PARTIALLY_AVAILABLE','UNHEALTHY','FAILED','UNKNOWN')),
  container_id    TEXT,  -- populated in CONTAINER mode only
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(service_id, instance_index)
);

-- Service dependencies (directed edges)
CREATE TABLE service_dependencies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  timeout_ms      INT NOT NULL DEFAULT 5000 CHECK (timeout_ms > 0),
  criticality     TEXT NOT NULL DEFAULT 'REQUIRED'
                  CHECK (criticality IN ('REQUIRED','OPTIONAL','BEST_EFFORT')),
  retry_policy    JSONB NOT NULL DEFAULT '{"type":"EXPONENTIAL","maxAttempts":3,"baseDelayMs":100,"maxDelayMs":30000,"jitterFactor":0.25,"budgetPercent":20}',
  circuit_breaker_policy JSONB NOT NULL DEFAULT '{"enabled":true,"threshold":5,"windowMs":10000,"cooldownMs":30000,"halfOpenProbes":3}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_service_id, target_service_id),
  -- Prevent self-edges
  CHECK (source_service_id != target_service_id)
);

CREATE INDEX service_deps_source_idx ON service_dependencies (source_service_id);
CREATE INDEX service_deps_target_idx ON service_dependencies (target_service_id);
CREATE INDEX service_deps_world_idx  ON service_dependencies (world_id);

-- Workloads
CREATE TABLE workloads (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  world_id        UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  pattern         TEXT NOT NULL DEFAULT 'CONSTANT'
                  CHECK (pattern IN ('CONSTANT','RAMP_UP','RAMP_DOWN','BURST','SPIKE','RANDOM')),
  base_rate       NUMERIC NOT NULL CHECK (base_rate >= 0),
  peak_rate       NUMERIC,
  duration_ms     BIGINT,
  config          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(world_id, name)
);
```

**Index rationale:**
- `services_world_status_idx`: covers `WHERE world_id = $1` (topology page) and
  `WHERE world_id = $1 AND status = 'FAILED'` (alert queries).
- `service_deps_source_idx` / `service_deps_target_idx`: separate indexes for the two traversal
  directions of graph algorithms (BFS/DFS use both).
- No index on `service_instances` beyond the PK — instance counts per service are small (1–10).

---

## 6. Packages

### packages/domain
```
src/
  world/
    world.entity.ts           WorldStatus enum + transition table; World type
    world-status.ts           isValidTransition(from, to): boolean; throw on illegal
  service/
    service.entity.ts         ServiceStatus enum + transition table; Service, ServiceInstance types
    service-status.ts         8 states incl. PARTIALLY_AVAILABLE
  dependency/
    dependency.entity.ts      ServiceDependency, RetryPolicy, CircuitBreakerPolicy types
    dependency.policy.ts      Policy defaults, validation
  workload/
    workload.entity.ts        WorkloadPattern enum, Workload type
  graph/
    graph.ts                  DependencyGraph class: adjacency list, built from ServiceDependency[]
    algorithms.ts             detectCycles(graph): CyclePath | null
                              topologicalOrder(graph): ServiceId[]
                              reachableFrom(graph, serviceId): Set<ServiceId>
                              criticalPath(graph, start, end): ServiceId[]
                              dependentsOf(graph, serviceId): Set<ServiceId>
    types.ts                  CyclePath, GraphMetrics, BlastRadius
  runtime/
    runtime-adapter.ts        RuntimeAdapter interface (see section 7)
    runtime-mode.ts           RuntimeMode enum, RuntimeCapabilities interface
    clock.ts                  Clock interface (VirtualClock and SystemClock share it)
  index.ts
```

### apps/control (additions)
```
src/modules/
  services/
    services.routes.ts
    services.controller.ts
    services.service.ts       createService, updateService, deleteService (cascade check)
    services.repository.ts    findByWorld, findById, create, update, delete
    services.schema.ts        createServiceBody, updateServiceBody
    index.ts
  dependencies/
    dependencies.routes.ts
    dependencies.controller.ts
    dependencies.service.ts   createDependency (cycle check), deleteDependency,
                              updatePolicy
    dependencies.repository.ts
    dependencies.schema.ts
    index.ts
  workloads/
    workloads.routes.ts
    workloads.controller.ts
    workloads.service.ts
    workloads.repository.ts
    workloads.schema.ts
    index.ts
```

---

## 7. Interfaces

### RuntimeAdapter (packages/domain — the central port)

```typescript
// packages/domain/src/runtime/runtime-adapter.ts

export type RuntimeMode = 'LOGICAL' | 'CONTAINER' | 'HYBRID';
export type DeterminismClass = 'DETERMINISTIC' | 'SEEDED_INPUTS' | 'NON_DETERMINISTIC';

export interface RuntimeCapabilities {
  readonly mode: RuntimeMode;
  readonly determinism: DeterminismClass;
  readonly maxServices: number;        // LOGICAL ~1000, CONTAINER ~8
  readonly maxWorkloadRate: number;    // LOGICAL ~50000/s, CONTAINER ~2000/s
  readonly supportedFaults: string[];  // FaultType enum values
  readonly supportsReplayVerification: boolean;
  readonly forcedDriver?: 'REALTIME';  // HYBRID cannot run FastDriver
}

export interface RuntimeHandle {
  readonly id: string;
  readonly mode: RuntimeMode;
  readonly worldId: string;
}

export interface WorkloadHandle { readonly id: string; }
export interface FaultHandle    { readonly id: string; }

export interface RuntimeSample {
  readonly serviceId: string;
  readonly virtualTimeUs: bigint;   // WORLD_VIRTUAL microseconds from run start
  readonly wallTimeMs: number;      // PLATFORM_WALL, for display ordering only
  readonly requestsCompleted: number;
  readonly requestsFailed: number;
  readonly latencySamplesUs: number[];   // raw, for exact quantiles (LOGICAL only)
  readonly queueDepth: number;
  readonly activeSlots: number;
  readonly circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
}

export interface ServiceHealth {
  readonly serviceId: string;
  readonly status: 'STARTING' | 'HEALTHY' | 'DEGRADED' | 'PARTIALLY_AVAILABLE' | 'UNHEALTHY' | 'FAILED';
  readonly instanceStatuses: Array<{ index: number; status: string; containerId?: string }>;
}

export interface WorldSpec {
  readonly worldId: string;
  readonly services: ServiceSpec[];
  readonly dependencies: DependencySpec[];
  readonly seed: bigint;
}

export interface ServiceSpec {
  readonly id: string;
  readonly name: string;
  readonly concurrencyLimit: number;
  readonly queueCapacity: number;
  readonly config: Record<string, unknown>;
}

export interface DependencySpec {
  readonly sourceId: string;
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly retryPolicy: RetryPolicySpec;
  readonly circuitBreakerPolicy: CircuitBreakerPolicySpec;
}

export interface WorkloadSpec {
  readonly pattern: 'CONSTANT' | 'RAMP_UP' | 'RAMP_DOWN' | 'BURST' | 'SPIKE' | 'RANDOM';
  readonly targetServiceId: string;
  readonly baseRate: number;
  readonly peakRate?: number;
  readonly durationMs?: number;
}

export interface FaultSpec {
  readonly faultId: string;
  readonly type: string;   // FaultType — defined in M04
  readonly targetServiceId: string;
  readonly parameters: Record<string, unknown>;
  readonly ttlMs: number;
}

export interface RuntimeAdapter {
  readonly mode: RuntimeMode;
  readonly capabilities: RuntimeCapabilities;

  provision(spec: WorldSpec): Promise<RuntimeHandle>;
  start(handle: RuntimeHandle): Promise<void>;
  applyWorkload(handle: RuntimeHandle, workload: WorkloadSpec): Promise<WorkloadHandle>;
  applyFault(handle: RuntimeHandle, fault: FaultSpec): Promise<FaultHandle>;
  removeFault(handle: RuntimeHandle, fault: FaultHandle): Promise<void>;
  observe(handle: RuntimeHandle): AsyncIterable<RuntimeSample>;
  health(handle: RuntimeHandle): Promise<ServiceHealth[]>;
  teardown(handle: RuntimeHandle): Promise<void>;
}
```

### Graph algorithms (packages/domain)

```typescript
// packages/domain/src/graph/algorithms.ts
export type ServiceId = string;
export interface CyclePath { services: ServiceId[] }

export function detectCycles(graph: DependencyGraph): CyclePath | null;
export function topologicalOrder(graph: DependencyGraph): ServiceId[];
export function reachableFrom(graph: DependencyGraph, serviceId: ServiceId): Set<ServiceId>;
export function criticalPath(graph: DependencyGraph, start: ServiceId, end: ServiceId): ServiceId[];
export function dependentsOf(graph: DependencyGraph, serviceId: ServiceId): Set<ServiceId>;
```

---

## 8. API

### Services
```
GET    /api/v1/worlds/:worldId/services
POST   /api/v1/worlds/:worldId/services
GET    /api/v1/worlds/:worldId/services/:serviceId
PATCH  /api/v1/worlds/:worldId/services/:serviceId
DELETE /api/v1/worlds/:worldId/services/:serviceId   409 if dependents exist
```

### Dependencies
```
GET    /api/v1/worlds/:worldId/dependencies
POST   /api/v1/worlds/:worldId/dependencies          422 if cycle detected (names the cycle)
GET    /api/v1/worlds/:worldId/dependencies/:id
PATCH  /api/v1/worlds/:worldId/dependencies/:id
DELETE /api/v1/worlds/:worldId/dependencies/:id
```

### Workloads
```
GET    /api/v1/worlds/:worldId/workloads
POST   /api/v1/worlds/:worldId/workloads
PATCH  /api/v1/worlds/:worldId/workloads/:id
DELETE /api/v1/worlds/:worldId/workloads/:id
```

### Graph query
```
GET    /api/v1/worlds/:worldId/graph
  Response: {
    services: ServiceNode[],
    dependencies: DependencyEdge[],
    metrics: { serviceCount, edgeCount, hasCycles: false, criticalPathLength }
  }
```

---

## 9. UI

### World overview / topology page (spec §19–22)
- Full-width React Flow canvas
- Node design (§20): service name, type icon, status badge (icon + text, never colour alone),
  instance count, health ring
- Status states (§21): STOPPED (gray), STARTING (blue), HEALTHY (green), DEGRADED (amber),
  PARTIALLY_AVAILABLE (amber striped), UNHEALTHY (red), FAILED (red filled), UNKNOWN (gray dashed)
- Interactions (§22):
  - Hover: tooltip showing instance count, latency P95 (null at M1, populated at M2), queue depth
  - Click: selects node, highlights direct edges (primary colour), dims others
  - Double-click: opens service drawer (§23)
  - Shift+click: multi-select for group operations
- Edge design: directed arrow, thickness = relative traffic weight (uniform at M1),
  status colour (healthy/degraded/failed)
- Toolbar: zoom in/out, fit, layout toggle, add service, add dependency

### Service drawer (spec §23)
- Right-side panel (400px), slides in on double-click
- Tabs: Overview, Instances, Dependencies, Policies
- Overview: status, type, concurrency limit, queue capacity, created date
- Dependencies tab: inbound list + outbound list, each with timeout_ms, criticality, retry type
- Policies tab: circuit breaker config, retry policy config (editable inline)

### Service page (spec §24–26)
- Dedicated page `/worlds/:worldId/services/:serviceId`
- Full service config, all instances, dependency graph scoped to this service,
  metric history (placeholder charts at M1 — populated from M2)

---

## 10. Steps

1. **packages/domain** — entities, state machines, transition tables.
2. **packages/domain/src/graph** — `DependencyGraph` class + all five algorithms + unit tests.
3. **packages/domain/src/runtime/runtime-adapter.ts** — interface + types, no implementation.
4. **Migration 002_topology.sql** + Drizzle schema extensions in packages/db.
5. **apps/control — services module** (all six files).
6. **apps/control — dependencies module** (all six files, cycle check in service layer).
7. **apps/control — workloads module** (all six files).
8. **Update gateway** to register new module routes.
9. **Update OpenAPI snapshot** (`npm run openapi:generate`).
10. **apps/web — topology page** — React Flow canvas, dagre layout, node/edge components.
11. **apps/web — service drawer** — right-side panel with tabs.
12. **apps/web — service page** — full service detail.
13. **Seed script** — creates the §10 reference topology (Gateway, Orders, Users, Inventory,
    Payments, Postgres) via the API.
14. **verify:m1 script**.

---

## 11. Testing

### Unit (packages/domain)
- `detectCycles`: acyclic graph -> null; A->B->C->A -> CyclePath with 3 services
- `reachableFrom('payments')` on the §10 topology -> { orders, gateway }
- `topologicalOrder`: correct order; throws on cyclic graph
- `criticalPath`: longest path between two nodes in a DAG
- `dependentsOf`: correct upstream set
- `WorldStatus` transition table: `IDLE -> RUNNING` allowed; `COMPLETED -> RUNNING` throws
- `ServiceStatus` transition table: all 8 states, valid and invalid transitions

### Integration (testcontainers)
- Create service -> appears in GET /services
- Create dependency A->B then B->A -> 422 naming the cycle
- Delete service with dependents -> 409 (never a dangling edge)
- Workload references a service in a different world -> 422

### Contract
- OpenAPI updated and committed after service/dependency/workload routes added

### E2E (Playwright)
- Seed §10 topology via API -> topology page renders 6 nodes and 8 edges
- Click Orders node -> drawer shows its two outbound dependencies (Inventory, Payments)

---

## 12. Gate

```bash
npm run verify:m1
```

1. Seed the §10 topology (Gateway, Orders, Users, Inventory, Payments, Postgres) via the API.
   Zero SQL inserts — API only.
2. GET /graph returns 6 services and 8 edges.
3. Topology page renders all 6 nodes and 8 edges in a browser.
4. POST a dependency creating a cycle -> 422 response body contains the cycle path as an array
   of service names.
5. `reachableFrom('payments')` unit test returns `{ orders, gateway }` (exact set).
6. DELETE /services/:paymentsId (which has dependents) -> 409.
7. No dangling edges after the 409 (GET /dependencies count unchanged).

---

## 13. Pitfalls

- **Cycle detection at read time.** Running detectCycles on every graph read is O(V+E) per request.
  Only run it on write (POST /dependencies). Cache the "has no cycles" invariant on the world row.

- **Self-edge CHECK constraint missed.** A service depending on itself is nonsensical and will
  confuse the BFS. The `CHECK (source_service_id != target_service_id)` constraint is in the DDL;
  also validate in the service layer for a cleaner error message.

- **react-flow re-layout on every render.** Run dagre layout only when the graph changes
  (use a stable memo, not an effect without deps). Re-layout on every render causes visible flicker.

- **Cascade delete surprising topology.** Deleting a world cascades to services and then to
  dependencies. This is correct behaviour, but the UI should confirm before deleting a world
  that has services.

- **Unused entity fields.** It is tempting to add fields to entities "for later". Every column that
  exists must be queried by something in this milestone or documented as a forward-compatibility
  placeholder. The abstraction-depth rule applies to schemas too.

---

## 14. Done

- [x] `npm run verify:m1` passes all 8 assertions
- [x] §10 reference topology created via API (no SQL inserts)
- [x] Cycle detection test: A->B->C->A returns cycle path
- [x] `reachableFrom('payments')` returns `{ orders, gateway }`
- [x] Deleting a service with dependents returns 409
- [x] Topology page renders with interactive React Flow canvas and dagre layout
- [x] `RuntimeAdapter` interface defined in `@mirrorgrid/domain`
- [x] `docs/adr/003-state-machines-as-data.md` written
- [x] OpenAPI snapshot compatible
