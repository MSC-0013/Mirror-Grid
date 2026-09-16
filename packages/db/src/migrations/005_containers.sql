-- 005_containers.sql: Container fleet tracking and runtime deployments

-- 1. Runtime deployment records
CREATE TABLE IF NOT EXISTS runtime_deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    runtime_mode VARCHAR(20) NOT NULL DEFAULT 'LOGICAL', -- LOGICAL, CONTAINER, HYBRID
    topology_version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(30) NOT NULL DEFAULT 'PENDING', -- PENDING, PROVISIONING, RUNNING, STOPPED, FAILED
    error_message TEXT,
    deployed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    terminated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_deployments_world ON runtime_deployments(world_id, status);

-- 2. Container instances tracking Docker container / process state
CREATE TABLE IF NOT EXISTS container_instances (
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

CREATE INDEX IF NOT EXISTS idx_containers_lookup ON container_instances(world_id, status);
CREATE INDEX IF NOT EXISTS idx_containers_docker_id ON container_instances(docker_container_id);

-- 3. Edge proxy routing records (Toxiproxy port allocation)
CREATE TABLE IF NOT EXISTS container_edge_proxies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES runtime_deployments(id) ON DELETE CASCADE,
    edge_id UUID NOT NULL REFERENCES service_dependencies(id) ON DELETE CASCADE,
    toxiproxy_listen_port INTEGER NOT NULL,
    target_host VARCHAR(120) NOT NULL,
    target_port INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_deployment_edge UNIQUE (deployment_id, edge_id)
);

CREATE INDEX IF NOT EXISTS idx_edge_proxies_deployment ON container_edge_proxies(deployment_id);
