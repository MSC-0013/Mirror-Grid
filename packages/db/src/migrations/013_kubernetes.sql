-- 013_kubernetes.sql: Kubernetes clusters, deployments, and HA chaos records (SQLite WAL mode)

-- 1. Registered Kubernetes Clusters
CREATE TABLE IF NOT EXISTS k8s_clusters (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    api_server_url TEXT NOT NULL,
    kubeconfig_context TEXT,
    cluster_version TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

-- 2. World Deployments in Kubernetes
CREATE TABLE IF NOT EXISTS k8s_deployments (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    cluster_id TEXT NOT NULL REFERENCES k8s_clusters(id) ON DELETE CASCADE,
    namespace TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'PROVISIONING' CHECK (status IN ('PROVISIONING', 'RUNNING', 'DEGRADED', 'TERMINATING', 'TERMINATED')),
    total_deployments INTEGER NOT NULL DEFAULT 0,
    total_pods INTEGER NOT NULL DEFAULT 0,
    healthy_pods INTEGER NOT NULL DEFAULT 0,
    deployed_at INTEGER NOT NULL,
    terminated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_k8s_deployments_world ON k8s_deployments(world_id, status);

-- 3. Kubernetes Chaos Injection and HA Audit Logs
CREATE TABLE IF NOT EXISTS k8s_chaos_events (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES k8s_deployments(id) ON DELETE CASCADE,
    chaos_type TEXT NOT NULL CHECK (chaos_type IN ('POD_KILL', 'OOM_KILL', 'ROLLING_UPDATE', 'NODE_CORDON', 'NETWORK_ISOLATION')),
    target_service_name TEXT NOT NULL,
    target_pod_name TEXT NOT NULL,
    traffic_offered_rps INTEGER NOT NULL DEFAULT 0,
    requests_successful INTEGER NOT NULL DEFAULT 0,
    requests_failed INTEGER NOT NULL DEFAULT 0,
    availability_percentage REAL NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER,
    status TEXT NOT NULL DEFAULT 'RUNNING'
);

CREATE INDEX IF NOT EXISTS idx_k8s_chaos_deployment ON k8s_chaos_events(deployment_id, started_at DESC);
