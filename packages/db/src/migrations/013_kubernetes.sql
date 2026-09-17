-- 013_kubernetes.sql: Kubernetes clusters, deployments, and HA chaos records (MySQL 8.4)

-- 1. Registered Kubernetes Clusters
CREATE TABLE IF NOT EXISTS k8s_clusters (
    id                 VARCHAR(36) PRIMARY KEY,
    name               VARCHAR(255) NOT NULL UNIQUE,
    api_server_url     VARCHAR(255) NOT NULL,
    kubeconfig_context TEXT,
    cluster_version    VARCHAR(255),
    is_active          INT NOT NULL DEFAULT 1,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. World Deployments in Kubernetes
CREATE TABLE IF NOT EXISTS k8s_deployments (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    cluster_id         VARCHAR(36) NOT NULL REFERENCES k8s_clusters(id) ON DELETE CASCADE,
    namespace          VARCHAR(255) NOT NULL UNIQUE,
    status             VARCHAR(255) NOT NULL DEFAULT 'PROVISIONING' CHECK (status IN ('PROVISIONING', 'RUNNING', 'DEGRADED', 'TERMINATING', 'TERMINATED')),
    total_deployments  INT NOT NULL DEFAULT 0,
    total_pods         INT NOT NULL DEFAULT 0,
    healthy_pods       INT NOT NULL DEFAULT 0,
    deployed_at        DATETIME(3) NOT NULL,
    terminated_at      DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_k8s_deployments_world ON k8s_deployments(world_id, status);

-- 3. Kubernetes Chaos Injection and HA Audit Logs
CREATE TABLE IF NOT EXISTS k8s_chaos_events (
    id                 VARCHAR(36) PRIMARY KEY,
    deployment_id      VARCHAR(36) NOT NULL REFERENCES k8s_deployments(id) ON DELETE CASCADE,
    chaos_type         VARCHAR(255) NOT NULL CHECK (chaos_type IN ('POD_KILL', 'OOM_KILL', 'ROLLING_UPDATE', 'NODE_CORDON', 'NETWORK_ISOLATION')),
    target_service_name VARCHAR(255) NOT NULL,
    target_pod_name    VARCHAR(255) NOT NULL,
    traffic_offered_rps INT NOT NULL DEFAULT 0,
    requests_successful INT NOT NULL DEFAULT 0,
    requests_failed    INT NOT NULL DEFAULT 0,
    availability_percentage DOUBLE NOT NULL,
    started_at         DATETIME(3) NOT NULL,
    completed_at       DATETIME(3),
    status             VARCHAR(255) NOT NULL DEFAULT 'RUNNING'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_k8s_chaos_deployment ON k8s_chaos_events(deployment_id, started_at DESC);
