-- 005_containers.sql: Container fleet tracking and runtime deployments

-- 1. Runtime deployment records
CREATE TABLE IF NOT EXISTS runtime_deployments (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    runtime_mode       VARCHAR(255) NOT NULL DEFAULT 'LOGICAL',
    topology_version   INT NOT NULL DEFAULT 1,
    status             VARCHAR(255) NOT NULL DEFAULT 'PENDING',
    error_message      TEXT,
    deployed_at        DATETIME(3) NOT NULL,
    terminated_at      DATETIME(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_deployments_world ON runtime_deployments(world_id, status);

-- 2. Container instances tracking Docker container / process state
CREATE TABLE IF NOT EXISTS container_instances (
    id                 VARCHAR(36) PRIMARY KEY,
    world_id           VARCHAR(36) NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    deployment_id      VARCHAR(36) NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    service_id         VARCHAR(36) NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    docker_container_id VARCHAR(36) NOT NULL,
    docker_image       VARCHAR(255) NOT NULL,
    service_port       INT NOT NULL,
    admin_port         INT NOT NULL,
    toxiproxy_port     INT,
    status             VARCHAR(255) NOT NULL DEFAULT 'CREATED',
    cpu_limit_cores    DECIMAL(18,6) NOT NULL DEFAULT 1.0,
    memory_limit_mb    INT NOT NULL DEFAULT 256,
    started_at         DATETIME(3),
    stopped_at         DATETIME(3),
    CONSTRAINT uq_service_deployment UNIQUE (deployment_id, service_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_containers_lookup ON container_instances(world_id, status);
CREATE INDEX idx_containers_docker_id ON container_instances(docker_container_id);

-- 3. Edge proxy routing records (Toxiproxy port allocation)
CREATE TABLE IF NOT EXISTS container_edge_proxies (
    id                 VARCHAR(36) PRIMARY KEY,
    deployment_id      VARCHAR(36) NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    edge_id            VARCHAR(36) NOT NULL REFERENCES service_dependencies(id) ON DELETE CASCADE,
    toxiproxy_listen_port INT NOT NULL,
    target_host        VARCHAR(255) NOT NULL,
    target_port        INT NOT NULL,
    is_active          INT NOT NULL DEFAULT 1,
    created_at         DATETIME(3) NOT NULL,
    CONSTRAINT uq_deployment_edge UNIQUE (deployment_id, edge_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_edge_proxies_deployment ON container_edge_proxies(deployment_id);
