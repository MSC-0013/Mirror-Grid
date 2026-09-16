-- 005_containers.sql: Container fleet tracking and runtime deployments

-- 1. Runtime deployment records
CREATE TABLE IF NOT EXISTS runtime_deployments (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    runtime_mode TEXT NOT NULL DEFAULT 'LOGICAL',
    topology_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    deployed_at INTEGER NOT NULL,
    terminated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_deployments_world ON runtime_deployments(world_id, status);

-- 2. Container instances tracking Docker container / process state
CREATE TABLE IF NOT EXISTS container_instances (
    id TEXT PRIMARY KEY,
    world_id TEXT NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    deployment_id TEXT NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    docker_container_id TEXT NOT NULL,
    docker_image TEXT NOT NULL,
    service_port INTEGER NOT NULL,
    admin_port INTEGER NOT NULL,
    toxiproxy_port INTEGER,
    status TEXT NOT NULL DEFAULT 'CREATED',
    cpu_limit_cores NUMERIC NOT NULL DEFAULT 1.0,
    memory_limit_mb INTEGER NOT NULL DEFAULT 256,
    started_at INTEGER,
    stopped_at INTEGER,
    CONSTRAINT uq_service_deployment UNIQUE (deployment_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_containers_lookup ON container_instances(world_id, status);
CREATE INDEX IF NOT EXISTS idx_containers_docker_id ON container_instances(docker_container_id);

-- 3. Edge proxy routing records (Toxiproxy port allocation)
CREATE TABLE IF NOT EXISTS container_edge_proxies (
    id TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    edge_id TEXT NOT NULL REFERENCES service_dependencies(id) ON DELETE CASCADE,
    toxiproxy_listen_port INTEGER NOT NULL,
    target_host TEXT NOT NULL,
    target_port INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    CONSTRAINT uq_deployment_edge UNIQUE (deployment_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_proxies_deployment ON container_edge_proxies(deployment_id);
