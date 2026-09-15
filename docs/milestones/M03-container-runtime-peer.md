# M03 — Container Runtime Peer

## 1. Context

MIRRORGRID’s deterministic logical simulator (`packages/sim`, M02) delivers blinding speed, 1000x replay,
and mathematical determinism. However, if MIRRORGRID only existed as an in-memory queueing model,
cynical observers could dismiss it as a synthetic simulation that fails to capture the messy realities
of real networks: kernel TCP buffers, thread scheduling jitter, context switching latency, garbage
collection pauses, and actual socket drops.

The Container Runtime Peer elevates MIRRORGRID into an authentic distributed systems laboratory. It spins
up real Linux containers inside Docker, executing microservice workloads over real HTTP/1.1, HTTP/2,
and gRPC connections.

Crucially, both runtimes implement the **exact same `RuntimeAdapter` interface** defined in M01:

```
                      +----------------------+
                      |    RuntimeAdapter    |
                      |   (M01 Contract)     |
                      +----------------------+
                                 |
              +------------------+------------------+
              |                                     |
              v                                     v
+---------------------------+         +---------------------------+
|   LogicalRuntimeAdapter   |         |  ContainerRuntimeAdapter  |
|     (packages/sim)        |         | (packages/container-rt)   |
| - In-memory event heap    |         | - Real Docker containers  |
| - VirtualClock microsecs  |         | - Real TCP / HTTP network |
| - 1000x replay speed      |         | - Toxiproxy fault engine  |
+---------------------------+         +---------------------------+
```

Any world topology modeled in MIRRORGRID can execute either logically or physically in containers with
zero changes to the topology definition. Furthermore, this milestone introduces **HYBRID mode**, where
high-volume background services run logically while critical path services run in actual containers.

---

## 2. Prerequisites

- M01 gate green (`verify:m1` — domain model and topology graph)
- M02 gate green (`verify:determinism` — logical runtime and metrics)
- M04 written (`M04-reliability-and-fault-engine.md` — reliability primitives core/shell contracts)
- Docker Compose profile: `--profile full` (Local Docker daemon accessible via socket or named pipe)

---

## 3. Scope

### In scope
- `apps/synthetic-service`: Fastify-based microservice container image parameterized by route definitions:
  simulates CPU/memory burn, handles upstream RPCs, enforces M04 reliability shells, and exposes admin API.
- W3C Trace Context (`traceparent`, `tracestate`) and `mg-deadline-at` header propagation across container hops.
- `apps/runtime-agent`: Daemon process orchestrating Docker container lifecycles via Docker Engine API (`dockerode`).
- Network fault injection via Toxiproxy sidecar containers (no privileged `NET_ADMIN` or Linux `tc` required).
- `packages/container-runtime`: `ContainerRuntimeAdapter` implementing `RuntimeAdapter`.
- Runtime Conformance Suite (`packages/conformance`): Unified verification suite executed against both
  adapters to guarantee behavioral equivalence.
- Database migration `005_containers.sql`: Container instances, port mappings, and runtime deployment records.
- UI: Container Fleet Manager screen, container status cards, live log streaming.

### Explicitly out of scope
- Multi-node Kubernetes orchestration, Helm charts, and custom CRDs (M12).
- Full multi-phase experiment orchestrator (M05).
- OpenTelemetry Collector / Jaeger daemon deployment (M09, though trace headers are emitted here).
- Dynamic kernel eBPF packet inspection.

---

## 4. Design

### The Synthetic Service (`apps/synthetic-service`)

Rather than forcing users to write bespoke code for every node in a simulated company (e.g. Orders,
Payments, Inventory, Notifications), MIRRORGRID provides a parameter-driven `synthetic-service` image:

1. **Configuration-Driven Routes:**
   Each service receives its route table via JSON at startup (or dynamically via Admin API `/admin/routes`).
   A route defines:
   - `cpuBurnMs`: Burn CPU via integer hashing loops to simulate compute load.
   - `baseLatencyMs`: Asynchronous wait simulating database query or internal processing.
   - `downstreamCalls`: List of outbound HTTP/gRPC requests to other services, executed sequentially or in parallel.
   - `failureRate`: Spontaneous internal error generation.
2. **Standardized Context Propagation:**
   - Injects and forwards W3C `traceparent: 00-<trace-id>-<span-id>-01`.
   - Propagates `mg-deadline-at`: Absolute microsecond unix timestamp. If `now >= deadline`, the synthetic
     service aborts processing immediately with HTTP 504 and sheds all downstream calls.
3. **Integrated Reliability Shells:**
   Outbound HTTP clients instantiate `NodeCircuitBreaker`, `NodeRetryExecutor`, and `Bulkhead` from `packages/reliability`.

### Fault Injection without `NET_ADMIN` (The Toxiproxy Pattern)

Traditional chaos engineering tools (Pumba, Chaos Mesh) inject packet drops and latency using Linux `tc`
(traffic control) and `netem` kernel modules. This requires running Docker with `--cap-add=NET_ADMIN`
or `--privileged`. On Windows Docker Desktop (WSL2) or macOS (Lima/Docker VM), `tc` frequently corrupts
the VM network interface or fails with permission errors.

**The Solution:** MIRRORGRID embeds **Toxiproxy** sidecars or per-edge proxies:
- Each service edge `A -> B` communicates via a dedicated Toxiproxy TCP port.
- To inject 200ms latency, the fault engine invokes Toxiproxy's HTTP API:
  `POST /proxies/edge_orders_payments/toxics` with `{ type: "latency", attributes: { latency: 200 } }`.
- Bandwidth limits, packet corruption, connection resets (`reset_peer`), and blackholes are injected
  at user space network proxy layer with zero Linux root privileges required.
- Works 100% reliably across Windows, macOS, and Linux CI environments.

### The Runtime Conformance Suite (`packages/conformance`)

To ensure `LogicalRuntimeAdapter` and `ContainerRuntimeAdapter` are true semantic peers, the test suite
executes the exact same suite against both:

```typescript
// packages/conformance/src/runtime-conformance.ts
export function runConformanceSuite(createAdapter: () => Promise<RuntimeAdapter>) {
  describe('Runtime Conformance Specification', () => {
    it('initializes world topology and reports all services healthy', ...);
    it('propagates calls across 3-tier service chain with trace context', ...);
    it('trips circuit breaker under injected 100% downstream failure', ...);
    it('sheds requests when deadline-at is exceeded', ...);
    it('gracefully terminates services on world stop', ...);
  });
}
```

### Hybrid Execution Mode

Users often want the fidelity of containers for their target service, but cannot afford the RAM
overhead of spinning up 50 containers on a developer laptop.

In **HYBRID mode**:
- Top-level ingress and the service under test run as real Docker containers.
- 40 downstream dependency services run inside a single Node.js process using `LogicalRuntimeAdapter`.
- An internal HTTP bridge routes calls crossing the boundary:
  - Container -> Simulated service: Calls hit a local bridge port that schedules an event in `LogicalRuntimeAdapter`.
  - Simulated service -> Container: Event heap execution triggers an HTTP client call to the container.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/005_containers.sql`:

```sql
-- 005_containers.sql: Container fleet tracking and runtime deployments

-- 1. Runtime deployment records
CREATE TABLE runtime_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    runtime_mode VARCHAR(20) NOT NULL DEFAULT 'LOGICAL', -- LOGICAL, CONTAINER, HYBRID
    topology_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, PROVISIONING, RUNNING, STOPPED, FAILED
    error_message TEXT,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminated_at TIMESTAMPTZ
);

CREATE INDEX idx_deployments_world ON runtime_deployments(world_id, status);

-- 2. Container instances tracking Docker container state
CREATE TABLE container_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    deployment_id UUID NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    docker_container_id VARCHAR(128) NOT NULL,
    docker_image VARCHAR(255) NOT NULL,
    service_port INTEGER NOT NULL,      -- Host mapped port for service traffic
    admin_port INTEGER NOT NULL,        -- Host mapped port for synthetic admin API
    toxiproxy_port INTEGER,             -- Host mapped port for inbound toxiproxy
    status VARCHAR(30) NOT NULL DEFAULT 'CREATED', -- CREATED, STARTING, HEALTHY, UNHEALTHY, STOPPED, EXITED
    cpu_limit_cores NUMERIC(4, 2) NOT NULL DEFAULT 1.0,
    memory_limit_mb INTEGER NOT NULL DEFAULT 256,
    started_at TIMESTAMPTZ,
    stopped_at TIMESTAMPTZ,
    CONSTRAINT uq_service_deployment UNIQUE (deployment_id, service_id)
);

CREATE INDEX idx_containers_lookup ON container_instances(world_id, status);
CREATE INDEX idx_containers_docker_id ON container_instances(docker_container_id);

-- 3. Edge proxy routing records (Toxiproxy port allocation)
CREATE TABLE container_edge_proxies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    edge_id UUID NOT NULL REFERENCES service_edges(id) ON DELETE CASCADE,
    toxiproxy_listen_port INTEGER NOT NULL,
    target_host VARCHAR(120) NOT NULL,
    target_port INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_deployment_edge UNIQUE (deployment_id, edge_id)
);

CREATE INDEX idx_edge_proxies_deployment ON container_edge_proxies(deployment_id);
```

### Index rationale
- `idx_deployments_world`: Rapid state query when loading world overview screen.
- `uq_service_deployment`: Guarantees exactly one container per service per deployment.
- `idx_containers_docker_id`: Enables fast callback correlation when receiving Docker daemon lifecycle events.

---

## 6. Packages

```
apps/synthetic-service/
├── Dockerfile                       # Multi-stage Alpine Node.js / Distroless image
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Fastify server startup
│   ├── routes/
│   │   ├── admin.ts                 # Dynamic configuration & route injection API
│   │   ├── health.ts                # Readiness & liveness probe endpoints
│   │   └── workload.ts              # Synthetic request handling engine
│   ├── engine/
│   │   ├── cpu-burner.ts            # Controlled CPU loop burn mechanism
│   │   ├── context.ts               # W3C traceparent & deadline header parser
│   │   └── rpc-client.ts            # Downstream caller with M04 reliability wrappers
apps/runtime-agent/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Runtime agent entry point
│   ├── docker/
│   │   ├── dockerode-client.ts      # Docker Engine socket API client
│   │   ├── container-factory.ts     # Container create/start/stop/inspect
│   │   └── port-allocator.ts        # Dynamic ephemeral host port pool manager
│   ├── toxiproxy/
│   │   └── toxi-client.ts           # Toxiproxy API client for network faults
│   └── supervisor/
│       └── health-monitor.ts        # Polling container health check status
packages/container-runtime/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Exports ContainerRuntimeAdapter
│   ├── adapter.ts                   # Implements RuntimeAdapter port
│   ├── hybrid-bridge.ts             # Gateway between Docker HTTP and sim event heap
│   └── log-collector.ts             # Multiplexes Docker stdout/stderr streams
packages/conformance/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Conformance test harness
│   └── suites/
│       ├── lifecycle.suite.ts       # Start/stop/teardown parity
│       ├── traffic.suite.ts         # Chain propagation parity
│       └── resilience.suite.ts      # Breaker and timeout parity
packages/db/
├── src/
│   ├── schema/
│   │   └── containers.ts            # Drizzle schema matching 005_containers.sql
│   └── migrations/
│       └── 005_containers.sql       # Migration DDL above
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               └── fleet/
│                   └── page.tsx     # Container fleet monitor & log inspector
```

---

## 7. Interfaces

### Container Runtime Adapter Contract

```typescript
// packages/container-runtime/src/adapter.ts
import type { RuntimeAdapter, WorldState, RuntimeMetrics } from '@mirrorgrid/sim';

export interface ContainerRuntimeConfig {
  readonly dockerSocketPath: string; // e.g. '/var/run/docker.sock' or '//./pipe/docker_engine'
  readonly baseImage: string;        // 'mirrorgrid/synthetic-service:latest'
  readonly hostNetworkMode: boolean;
  readonly basePortRange: { readonly min: number; readonly max: number };
}

export interface ContainerRuntimeAdapter extends RuntimeAdapter {
  readonly mode: 'CONTAINER';

  /** Deploy topology graph into Docker container mesh */
  deployWorld(worldId: string): Promise<DeploymentResult>;

  /** Fetch live container status from Docker engine */
  getFleetStatus(worldId: string): Promise<readonly ContainerStatus[]>;

  /** Stream stdout/stderr logs from a specific service container */
  streamLogs(containerId: string, options: LogStreamOptions): AsyncIterable<string>;

  /** Teardown and prune all containers for a world */
  destroyWorld(worldId: string): Promise<void>;
}
```

### Synthetic Service Configuration Contract

```typescript
// apps/synthetic-service/src/routes/admin.ts

export interface DownstreamRpcCall {
  readonly serviceName: string;
  readonly targetUrl: string;
  readonly timeoutMs: number;
  readonly retryAttempts: number;
  readonly fallbackResponse?: unknown;
}

export interface SyntheticRouteDefinition {
  readonly path: string;
  readonly method: 'GET' | 'POST';
  readonly cpuBurnMs: number;
  readonly memoryAllocBytes: number;
  readonly baseLatencyMs: number;
  readonly errorProbabilityPpm: number; // 0 to 1,000,000
  readonly downstreamCalls: readonly DownstreamRpcCall[];
}

export interface SyntheticServiceConfig {
  readonly serviceId: string;
  readonly serviceName: string;
  readonly routes: readonly SyntheticRouteDefinition[];
  readonly adminPort: number;
  readonly servicePort: number;
}
```

---

## 8. API

Routes registered under `/api/v1/worlds/:worldId/runtime` in `apps/control`.

### 1. Deploy World to Containers
- `POST /api/v1/worlds/:worldId/runtime/deploy`
- **Request Body (zod schema):**
  ```typescript
  export const deployRuntimeSchema = z.object({
    runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']).default('CONTAINER'),
    cpuLimitCores: z.number().positive().default(1.0),
    memoryLimitMb: z.number().int().positive().default(256),
  });
  ```
- **Response:** `202 Accepted` with `{ deploymentId: string, status: 'PROVISIONING' }`.

### 2. Get Container Fleet Status
- `GET /api/v1/worlds/:worldId/runtime/fleet`
- **Response:** `200 OK` with list of container states:
  ```json
  {
    "deploymentId": "uuid",
    "runtimeMode": "CONTAINER",
    "containers": [
      {
        "serviceId": "uuid",
        "serviceName": "orders",
        "dockerContainerId": "a1b2c3d4e5f6",
        "status": "HEALTHY",
        "servicePort": 18001,
        "adminPort": 19001,
        "cpuUsage": 14.2,
        "memoryUsageMb": 42
      }
    ]
  }
  ```

### 3. Restart Container
- `POST /api/v1/worlds/:worldId/runtime/containers/:containerId/restart`
- **Response:** `200 OK` with `{ status: 'RESTARTING' }`.

### 4. Fetch Container Logs
- `GET /api/v1/worlds/:worldId/runtime/containers/:containerId/logs`
- **Query Params:** `tail?: number`, `since?: string`
- **Response:** `200 OK` with `{ logs: string[] }`.

---

## 9. UI

### Container Fleet Manager (`apps/web/src/app/worlds/[worldId]/fleet/page.tsx`)
- **Spec alignment:** §55 (Container Mesh Inspector), §56 (Live Container Logs).
- **Layout:**
  - Header: World name, active deployment badge (`Mode: CONTAINER`, `Total Containers: N`, `Healthy: N/N`).
  - Runtime Switcher: Toggle between `Logical (Simulated)` and `Container (Docker)`.
  - Fleet Grid: Card for each service showing:
    - Service Name & Container ID badge.
    - Status Indicator: Green (Healthy), Amber (Starting), Red (Unhealthy/Exited).
    - Resource Gauges: Live CPU % bar, Memory MB bar.
    - Mapped Ports: `traffic: :18001`, `admin: :19001`.
    - Action Menu: `Restart`, `View Logs`, `Inspect Config`.
  - Slide-over Log Drawer: ANSI terminal log viewer streaming container stdout/stderr with search and pause toggles.

---

## 10. Steps

1. **Build `apps/synthetic-service` Docker image:**
   Create Fastify HTTP application with route engine, CPU burner loop, and W3C traceparent propagation.
2. **Integrate M04 reliability wrappers in synthetic service:**
   Connect `NodeCircuitBreaker` and `NodeRetryExecutor` into outbound HTTP RPC client.
3. **Build `apps/runtime-agent` Docker supervisor:**
   Implement `dockerode` lifecycle client (container creation, network bridge attachment, teardown).
4. **Implement ephemeral port allocator:**
   Build collision-free host port reservation manager for Docker and Toxiproxy.
5. **Implement Toxiproxy integration:**
   Build client to create proxies for service edges and apply toxics dynamically.
6. **Implement `ContainerRuntimeAdapter` in `packages/container-runtime`:**
   Wire adapter to implement `RuntimeAdapter` port from M01.
7. **Database migration `005_containers.sql`:**
   Add Drizzle schema and SQL migration for container instances and deployments.
8. **Build Runtime Conformance Suite (`packages/conformance`):**
   Create shared verification tests asserting equivalence between logical and container adapters.
9. **Build Control Plane endpoints:**
   Add routes in `apps/control/src/modules/containers` for deploy, fleet status, and log inspection.
10. **Build Web UI Fleet Manager:**
    Implement `apps/web/src/app/worlds/[worldId]/fleet/page.tsx`.
11. **Implement Hybrid execution bridge:**
    Connect logical simulation event heap to Docker container HTTP ingress.
12. **Create Verification Gate script:**
    Implement `npm run verify:m3` validating container provisioning, routing, and conformance suite pass.

---

## 11. Testing

### Unit tests (`packages/container-runtime/tests/unit`)
- `port-allocator.test.ts`: Verify non-overlapping host port assignment across 50 concurrent services.
- `cpu-burner.test.ts`: Verify CPU burn loop consumes approximate requested milliseconds without blocking event loop indefinitely.
- `synthetic-routes.test.ts`: Verify complex downstream call graph execution and timeout enforcement.

### Integration tests (`apps/runtime-agent/tests/integration`)
- `docker-lifecycle.test.ts`: Spin up 3 synthetic containers, verify health probes pass, gracefully terminate.
- `toxiproxy-fault.test.ts`: Inject 150ms latency toxic on inter-container edge and assert measured round-trip increases by 150ms.

### Conformance tests (`packages/conformance/tests`)
- Run `runConformanceSuite(logicalAdapter)`.
- Run `runConformanceSuite(containerAdapter)`.
- Assert both implementations satisfy 100% of behavioral assertions.

---

## 12. Gate

Command: `npm run verify:m3`

The gate script spins up an ephemeral 3-node Docker topology and verifies these 5 assertions:

```typescript
// tests/gates/verify-m3.ts

// Assertion 1: Docker containers spin up and pass HTTP health checks within 10 seconds
assert(containersHealthy, 'Assertion 1: Container fleet boots cleanly and reports HEALTHY');

// Assertion 2: Synthetic service executes multi-tier RPC chain with trace context
// Verified: Gateway -> Orders -> Inventory carries identical traceId and incremented spanId
assert(traceContextPropagated, 'Assertion 2: W3C traceparent propagates through container mesh');

// Assertion 3: Toxiproxy successfully injects network fault without NET_ADMIN
// Verified: 100ms injected latency toxic reflects accurately in HTTP client roundtrip
assert(toxicObserved, 'Assertion 3: Toxiproxy network latency injected successfully');

// Assertion 4: Container-side Circuit Breaker trips to OPEN under downstream failure
// Verified: Synthetic service breaker opens after 5 consecutive 500 errors, shedding further calls
assert(containerBreakerTripped, 'Assertion 4: Container circuit breaker trips under failure');

// Assertion 5: Runtime Conformance Suite passes against both Logical and Container adapters
assert(conformancePassed, 'Assertion 5: Both runtimes satisfy full Conformance Suite');
```

---

## 13. Pitfalls

1. **Hardcoding container host ports:** Parallel CI jobs or developer machines will fail immediately with
   `EADDRINUSE`. Always use an ephemeral port allocator with dynamic allocation.
2. **Requiring `NET_ADMIN` in container specs:** Fails on default Windows Docker Desktop and rootless environments.
   Stick strictly to user-space Toxiproxy for network fault injection.
3. **Leaking orphan containers after test failures:** A failed test or `SIGINT` must be caught with process
   signal handlers (`beforeExit`, `SIGTERM`, `SIGINT`) to clean up Docker containers and network bridges.
4. **Boot race conditions:** Starting consumer services before downstream dependencies are listening causes
   connection refused errors. Synthetic services must include configurable startup retry loops.
5. **Flooding Docker daemon with log streaming:** Polling Docker logs too aggressively exhausts socket handles.
   Always use multiplexed demux streams (`dockerode.modem.demuxStream`).

---

## 14. Done

- [ ] `apps/synthetic-service` Dockerfile builds and runs locally with minimal image footprint.
- [ ] Synthetic service accurately parses and propagates W3C trace context and `mg-deadline-at`.
- [ ] `packages/container-runtime` implements `RuntimeAdapter` cleanly without leaking Docker specifics.
- [ ] Toxiproxy injects latency, packet drops, and connection resets without requiring root privileges.
- [ ] Runtime Conformance Suite passes identically against both `LogicalRuntimeAdapter` and `ContainerRuntimeAdapter`.
- [ ] Migration `005_containers.sql` applied cleanly in Postgres.
- [ ] Container Fleet Manager screen live in web app with real-time health badges.
- [ ] `npm run verify:m3` runs green in CI with all 5 gate assertions passing.
