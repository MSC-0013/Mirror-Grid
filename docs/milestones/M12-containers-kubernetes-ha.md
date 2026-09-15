# M12 — Containers, Kubernetes Orchestration, and High Availability

## 1. Context

In modern cloud-native architectures, microservices do not run as standalone Docker containers on a single
host; they run inside **Kubernetes** clusters scheduled across heterogeneous compute nodes. In Kubernetes,
failure modes are fundamentally distinct from single-machine Docker:
- Pods are ephemeral and can be evicted, rescheduled, or OOM-killed at any instant.
- Rolling updates introduce mixed-version deployments where old and new service versions coexist.
- Kubernetes Services and Endpoints rely on asynchronous iptables/IPVS updates; if a Pod dies before
  endpoints update, in-flight traffic blackholes unless proper pre-stop hooks and readiness probes exist.
- NetworkPolicies partition namespaces, and Node drains force concurrent migrations.

Following M03 (local Docker container peer), this milestone delivers the **Kubernetes Orchestration Peer**:
MIRRORGRID topologies can be compiled into native Kubernetes manifests and deployed into any standard
Kubernetes cluster (k3s, kind, Minikube, or cloud-managed EKS/GKE).

Furthermore, this milestone formalizes **High Availability (HA) verification**: proving that a multi-replica
service architecture survives Pod kills, node drains, and rolling updates with **zero client-visible 5xx errors**.

---

## 2. Prerequisites

- M03 green (`verify:m3` — container runtime peer)
- M05 green (`verify:flagship` — experiment engine)
- M08 green (`verify:events` — event platform)
- Docker Compose profile: `--profile full` or local Kubernetes cluster accessible via `KUBECONFIG` (k3s / kind / Docker Desktop Kubernetes)

---

## 3. Scope

### In scope
- `packages/k8s`: Kubernetes client integration using `@kubernetes/client-node`, dynamic manifest compiler,
  and namespace isolation manager.
- World-to-Kubernetes compilation: Translating MIRRORGRID services into Kubernetes `Deployments`, `Services`,
  `ConfigMaps`, `HorizontalPodAutoscalers` (HPA), and `NetworkPolicies`.
- Kubernetes-native chaos injection: Pod termination, crash loop simulation, OOMKill trigger via memory exhaustion,
  node cordoning, and network partition policies.
- High Availability (HA) verification: Proving zero-downtime rolling deploys (`maxUnavailable: 0`) and graceful
  Pod shutdown with `preStop` sleep hooks.
- Database migration `013_kubernetes.sql`: `k8s_clusters`, `k8s_deployments`, `k8s_chaos_events`.
- Web UI: Kubernetes Cluster & Pod Mesh Inspector (§76), live Pod terminal, and HA failover tester.

### Explicitly out of scope
- Custom eBPF Linux kernel CNI plugin development.
- Multi-cloud federation across disparate cloud providers (e.g. AWS to Azure live failover).
- Managing persistent Kubernetes storage volumes (PVCs) for stateful databases (stateless microservice tier targeted).

---

## 4. Design

### World-to-Kubernetes Manifest Compiler

The compiler takes a MIRRORGRID World definition and produces standard Kubernetes API objects:

```
+-------------------------------------------------------------------------+
|                        MIRRORGRID World Definition                      |
+-------------------------------------------------------------------------+
                                   |
                                   v  (packages/k8s/src/compiler)
+-------------------------------------------------------------------------+
|                      Namespace: mg-world-<worldId>                      |
|                                                                         |
|  +---------------------------+             +-------------------------+  |
|  |   Deployment: orders      |             |   Deployment: payments  |  |
|  |   replicas: 3             | ----------> |   replicas: 3           |  |
|  |   image: synthetic-service|   (Edge)    |   image: synthetic...   |  |
|  +---------------------------+             +-------------------------+  |
|               |                                         |               |
|               v                                         v               |
|  +---------------------------+             +-------------------------+  |
|  |   Service: orders-svc     |             |   Service: payments-svc |  |
|  +---------------------------+             +-------------------------+  |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |   NetworkPolicy: Allow orders -> payments only (deny all other)   |  |
|  +-------------------------------------------------------------------+  |
+-------------------------------------------------------------------------+
```

1. **Namespace Isolation:** Every world runs in an ephemeral namespace `mg-world-<uuid>` with strict resource quotas.
2. **Standard Deployment Specs:**
   - Pre-stop hooks: `lifecycle.preStop.exec.command: ["sleep", "5"]` to allow iptables endpoint propagation.
   - Probes: HTTP `/health/readiness` and `/health/liveness` configured with 1-second timeout.
   - Anti-affinity: Pods are scheduled across distinct physical nodes or availability zones.
3. **NetworkPolicy Enforcement:** Default-deny ingress rules with explicit permits matching MIRRORGRID service edges.

### The Zero-Downtime HA Invariant

A primary claim of high availability is that **Pod termination must not drop traffic**.
In a naive Kubernetes setup, running `kubectl delete pod` causes ~1-2 seconds of connection resets because
the Pod is killed before the ingress controller removes its IP from endpoints.

MIRRORGRID tests and enforces the complete zero-downtime termination sequence:

```
[ SIGTERM issued by Kubelet ]
      |
      +---> Kubelet executes preStop hook ("sleep 5")
      |     (Synthetic service continues serving in-flight traffic)
      |
      +---> Endpoints controller removes Pod IP from Service Endpoints
            (Ingress stops routing new requests to this Pod)
      |
[ preStop completes (5s elapsed) ]
      |
[ Application receives SIGTERM ]
      |
      +---> Stops accepting new connections
      +---> Flushes in-flight HTTP requests and Kafka outbox records
      +---> Closes listening sockets and exits cleanly (Code 0)
```
The verification gate (`verify:ha`) floods a 3-replica service with 200 req/s while terminating Pods and
asserts **100.0% HTTP 200 success rate**.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/013_kubernetes.sql`:

```sql
-- 013_kubernetes.sql: Kubernetes clusters, deployments, and HA chaos records

-- 1. Registered Kubernetes Clusters
CREATE TABLE k8s_clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL UNIQUE,
    api_server_url VARCHAR(255) NOT NULL,
    kubeconfig_context VARCHAR(120),
    cluster_version VARCHAR(50),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. World Deployments in Kubernetes
CREATE TABLE k8s_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    cluster_id UUID NOT NULL REFERENCES k8s_clusters(id) ON DELETE CASCADE,
    namespace VARCHAR(120) NOT NULL UNIQUE,
    status VARCHAR(30) NOT NULL DEFAULT 'PROVISIONING', -- PROVISIONING, RUNNING, DEGRADED, TERMINATING, TERMINATED
    total_deployments INTEGER NOT NULL DEFAULT 0,
    total_pods INTEGER NOT NULL DEFAULT 0,
    healthy_pods INTEGER NOT NULL DEFAULT 0,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminated_at TIMESTAMPTZ
);

CREATE INDEX idx_k8s_deployments_world ON k8s_deployments(world_id, status);

-- 3. Kubernetes Chaos Injection and HA Audit Logs
CREATE TABLE k8s_chaos_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES k8s_deployments(id) ON DELETE CASCADE,
    chaos_type VARCHAR(50) NOT NULL, -- POD_KILL, OOM_KILL, ROLLING_UPDATE, NODE_CORDON, NETWORK_ISOLATION
    target_service_name VARCHAR(120) NOT NULL,
    target_pod_name VARCHAR(120) NOT NULL,
    traffic_offered_rps INTEGER NOT NULL DEFAULT 0,
    requests_successful BIGINT NOT NULL DEFAULT 0,
    requests_failed BIGINT NOT NULL DEFAULT 0,
    availability_percentage NUMERIC(6, 3) NOT NULL, -- Must be 100.000 for HA verification
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status VARCHAR(30) NOT NULL DEFAULT 'RUNNING'
);

CREATE INDEX idx_k8s_chaos_deployment ON k8s_chaos_events(deployment_id, started_at DESC);
```

### Index rationale
- `idx_k8s_deployments_world`: Instant retrieval of live Kubernetes status on world load.
- `idx_k8s_chaos_deployment`: Audit history of HA experiments per deployment.

---

## 6. Packages

```
packages/k8s/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public Kubernetes API
│   ├── client/
│   │   ├── k8s-client.ts            # @kubernetes/client-node wrapper
│   │   └── namespace-manager.ts     # Ephemeral namespace lifecycle manager
│   ├── compiler/
│   │   ├── manifest-generator.ts    # Topology -> K8s YAML/JSON compiler
│   │   ├── deployment-spec.ts       # Pod template with probes and preStop hooks
│   │   ├── service-spec.ts          # ClusterIP service definitions
│   │   └── netpol-spec.ts           # NetworkPolicy security isolation
│   └── chaos/
│       ├── pod-killer.ts            # Graceful and forceful Pod termination
│       ├── oom-injector.ts          # Memory pressure generator
│       └── rolling-update.ts        # Zero-downtime rolling deploy validator
packages/db/
├── src/
│   ├── schema/
│   │   └── kubernetes.ts            # Drizzle schema matching 013_kubernetes.sql
│   └── migrations/
│       └── 013_kubernetes.sql       # Migration DDL above
apps/control/
├── src/
│   └── modules/
│       └── k8s/
│           ├── k8s.routes.ts        # Endpoints for K8s deployment and chaos
│           ├── k8s.controller.ts
│           └── k8s.service.ts
apps/web/
├── src/
│   └── app/
│       └── worlds/
│           └── [worldId]/
│               └── k8s/
│                   ├── page.tsx     # Kubernetes Cluster & Pod Mesh Inspector (§76)
│                   └── ha/
│                       └── page.tsx # HA Failover & Rolling Deploy Validator
```

---

## 7. Interfaces

### Kubernetes Deployment and Manifest Contracts

```typescript
// packages/k8s/src/compiler/manifest-generator.ts
import type { TopologyExport } from '@mirrorgrid/topology';

export interface K8sResourceRequirements {
  readonly cpuRequest: string;       // e.g. '100m'
  readonly cpuLimit: string;         // e.g. '500m'
  readonly memoryRequest: string;    // e.g. '128Mi'
  readonly memoryLimit: string;     // e.g. '256Mi'
}

export interface K8sManifestBundle {
  readonly namespace: string;
  readonly deployments: readonly unknown[];
  readonly services: readonly unknown[];
  readonly networkPolicies: readonly unknown[];
}

export interface K8sCompiler {
  compileWorld(worldId: string, topology: TopologyExport): K8sManifestBundle;
}
```

### High Availability Verification Contract

```typescript
// packages/k8s/src/chaos/rolling-update.ts

export interface HaTestResult {
  readonly testType: 'POD_KILL' | 'ROLLING_UPDATE' | 'NODE_CORDON';
  readonly totalRequests: number;
  readonly successfulRequests: number;
  readonly failedRequests: number;
  readonly availabilityPercentage: number;
  readonly maxLatencyMs: number;
  readonly zeroDowntimeAchieved: boolean;
}

export interface HaValidator {
  validatePodTermination(namespace: string, deploymentName: string): Promise<HaTestResult>;
  validateRollingDeploy(namespace: string, deploymentName: string): Promise<HaTestResult>;
}
```

---

## 8. API

Routes registered in `apps/control` under `/api/v1/worlds/:worldId/k8s`.

### 1. Deploy World to Kubernetes Cluster
- `POST /api/v1/worlds/:worldId/k8s/deploy`
- **Request Body (zod schema):**
  ```typescript
  export const deployK8sSchema = z.object({
    clusterId: z.string().uuid().optional(),
    replicasPerService: z.number().int().min(1).max(10).default(3),
    enableNetworkPolicies: z.boolean().default(true),
  });
  ```
- **Response:** `202 Accepted` with `{ deploymentId: string, namespace: string, status: 'PROVISIONING' }`.

### 2. Get Live Pod Mesh Status
- `GET /api/v1/worlds/:worldId/k8s/status`
- **Response:** `200 OK` with list of Pods, container states, node names, and restart counts.

### 3. Inject Kubernetes Chaos (Pod Kill)
- `POST /api/v1/worlds/:worldId/k8s/chaos/pod-kill`
- **Request Body:** `{ serviceName: string, gracePeriodSeconds?: number }`
- **Response:** `200 OK` with `{ terminatedPod: string, replacementPod: string, haScorecard: HaTestResult }`.

### 4. Trigger Zero-Downtime Rolling Update
- `POST /api/v1/worlds/:worldId/k8s/chaos/rolling-update`
- **Request Body:** `{ serviceName: string, newImageTag: string }`
- **Response:** `200 OK` with `{ status: 'COMPLETED', haScorecard: HaTestResult }`.

---

## 9. UI

### 1. Kubernetes Cluster & Pod Mesh Inspector (`apps/web/src/app/worlds/[worldId]/k8s/page.tsx`)
- **Spec alignment:** §76 (Kubernetes Cluster & Pod Mesh Inspector).
- **Layout:**
  - **Header HUD:** Cluster Name (`kind-mirrorgrid`), Namespace (`mg-world-a1b2`),
    Pod Health (`12/12 READY`), Total Restarts (`0`).
  - **Pod Grid Matrix:**
    - Cards grouped by Service (e.g. Orders: 3 Pods, Payments: 3 Pods).
    - Each Pod Card displays:
      - Pod Name (`orders-78cf6b499f-x4k2l`)
      - State badge: Green `Running`, Amber `Terminating`, Blue `ContainerCreating`
      - Node assignment (`kind-worker-2`)
      - Restarts badge (`0 restarts`)
      - Quick-Action: `Kill Pod (Graceful)`, `Kill Pod (Force -9)`.
  - **Live Pod Terminal Drawer:** Integrated ANSI web terminal streaming logs from selected Pod.

### 2. High Availability Failover Validator (`apps/web/src/app/worlds/[worldId]/k8s/ha/page.tsx`)
- **Visuals:**
  - Active HA Gauge: **100.000% Availability Under Disruption** (Target: 100%).
  - Real-time RPS Traffic Chart with vertical marker showing exact moment of Pod termination.
  - Failover Scorecard: `Pre-Stop Delay: 5s`, `Endpoint Propagation: 1.2s`, `Dropped Requests: 0`.

---

## 10. Steps

1. **Create `packages/k8s` package:** Setup `@kubernetes/client-node` dependencies and tsconfig.
2. **Build Manifest Generator:** Implement compiler generating Deployments, Services, and NetworkPolicies.
3. **Implement Graceful Shutdown Spec:** Embed `preStop` hooks and readiness/liveness probes in Pod templates.
4. **Implement Namespace Lifecycle Manager:** Build automated namespace provisioning and cleanup routines.
5. **Implement Kubernetes Pod Killer:** Build chaos tool to evict/kill pods gracefully or forcefully.
6. **Implement Rolling Update Orchestrator:** Build rolling deploy tester verifying zero-downtime guarantees.
7. **Database migration `013_kubernetes.sql`:** Apply schema for K8s clusters, deployments, and chaos records.
8. **Build Control Plane K8s modules:** Register routes for deployment, pod mesh status, and chaos injection.
9. **Build Pod Mesh Inspector UI:** Implement `apps/web/src/app/worlds/[worldId]/k8s/page.tsx`.
10. **Build HA Validator UI:** Implement `apps/web/src/app/worlds/[worldId]/k8s/ha/page.tsx`.
11. **Connect Synthetic Service to K8s SIGTERM:** Ensure `apps/synthetic-service` drains in-flight requests cleanly.
12. **Implement `npm run verify:ha` gate script:** Automated verification suite certifying Kubernetes HA.

---

## 11. Testing

### Unit tests (`packages/k8s/tests/unit`)
- `manifest-generator.test.ts`: Verify generated Kubernetes YAML adheres strictly to v1 OpenAPI schemas.
- `network-policy.test.ts`: Verify generated NetworkPolicy rules permit only explicitly declared service edges.

### Integration tests (`packages/k8s/tests/integration`)
- Deploy 3-service topology to local Kubernetes cluster (k3s/kind).
- Assert all Pods transition to `Ready = True` within 30 seconds.
- Execute NetworkPolicy verification: assert unauthorized inter-pod traffic is blocked with connection timeout.

### HA Stress Test (`tests/ha/pod-failover.test.ts`)
- Flood service with 200 req/s continuous workload.
- Terminate 1 Pod every 10 seconds across 3 iterations.
- Assert 100.0% of requests return HTTP 200 OK with zero dropped connections.

---

## 12. Gate

Command: `npm run verify:ha`

The gate test validates these 5 Kubernetes High Availability assertions:

```typescript
// tests/gates/verify-ha.ts

// Assertion 1: Generated Kubernetes manifests validate cleanly against K8s OpenAPI schema
assert(manifestsSchemaValid, 'Assertion 1: Kubernetes manifests compile with valid schema');

// Assertion 2: Multi-replica deployment boots in cluster and passes all readiness probes
assert(allPodsReady, 'Assertion 2: Multi-replica deployment reaches READY state');

// Assertion 3: Graceful Pod termination under load achieves 100% availability (0 dropped requests)
assert(podKillHaResult.availabilityPercentage === 100.0 && podKillHaResult.failedRequests === 0,
  'Assertion 3: Pod termination achieves 100% availability with zero dropped requests');

// Assertion 4: Rolling update completes under continuous traffic with zero downtime
assert(rollingDeployResult.zeroDowntimeAchieved, 'Assertion 4: Rolling update completes with zero downtime');

// Assertion 5: Ephemeral namespace teardown purges 100% of cluster resources cleanly
assert(namespaceCleanlyDeleted, 'Assertion 5: Namespace teardown cleanly cascades all resources');
```

---

## 13. Pitfalls

1. **Omitting `preStop` hooks:** Without a preStop sleep hook, Kubernetes removes the pod from endpoints
   and sends SIGTERM simultaneously. Network packets already in flight hit an exiting container,
   causing client 502/504 errors.
2. **Missing Readiness Probes:** If a new container starts during a rolling deploy, Kubernetes routes
   traffic to it before the app is actually listening unless a readiness probe guards it.
3. **Stuck namespace deletions:** A failed test can leave namespaces stuck in `Terminating` if resources
   have unhandled finalizers. Strip finalizers during cleanup.
4. **Hardcoding Kubeconfig paths:** CI pipelines run in containerized environments with in-cluster service
   accounts. Always support both local `~/.kube/config` and in-cluster credentials.

---

## 14. Done

- [ ] `packages/k8s` compiles under strict TypeScript with 0 errors.
- [ ] World topology compiler generates valid Kubernetes Deployments, Services, and NetworkPolicies.
- [ ] Synthetic service handles SIGTERM gracefully with zero dropped requests.
- [ ] Pod termination under load achieves 100.0% availability.
- [ ] Migration `013_kubernetes.sql` applied cleanly in Postgres.
- [ ] Kubernetes Pod Mesh Inspector and HA Failover screens functional in UI.
- [ ] `npm run verify:ha` runs green in CI with all 5 gate assertions passing.
