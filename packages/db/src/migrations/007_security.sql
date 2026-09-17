-- 007_security.sql: Authentication, RBAC, session management, and tamper-evident audit ledger

-- 1. Extend users table with status if not present
ALTER TABLE users ADD COLUMN status VARCHAR(255) NOT NULL DEFAULT 'ACTIVE';

-- 2. Roles and Permissions tables
CREATE TABLE IF NOT EXISTS roles (
    id                 VARCHAR(36) PRIMARY KEY,
    description        TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS permissions (
    id                 VARCHAR(36) PRIMARY KEY,
    description        TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id            VARCHAR(36) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id      VARCHAR(36) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS user_roles (
    user_id            VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id            VARCHAR(36) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. Tamper-evident append-only Audit Ledger
CREATE TABLE IF NOT EXISTS audit_logs (
    id                 VARCHAR(36) PRIMARY KEY,
    seq_num            INT NOT NULL UNIQUE,
    prev_hash          VARCHAR(64) NOT NULL,
    record_hash        VARCHAR(64) NOT NULL UNIQUE,
    user_id            VARCHAR(36) REFERENCES users(id) ON DELETE SET NULL,
    user_email         VARCHAR(255) NOT NULL,
    action             VARCHAR(255) NOT NULL,
    resource_type      VARCHAR(255) NOT NULL,
    resource_id        VARCHAR(36) NOT NULL,
    diff_json          JSON NOT NULL DEFAULT ('{}'),
    client_ip          VARCHAR(255) NOT NULL,
    user_agent         TEXT,
    created_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX idx_audit_logs_seq ON audit_logs(seq_num ASC);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);

-- 4. Initial Seed Data
INSERT IGNORE INTO roles (id, description) VALUES
    ('ADMIN', 'Full administrative access to the platform, security, and audit logs'),
    ('OPERATOR', 'Can create topologies, configure and run experiments, and inject faults'),
    ('VIEWER', 'Read-only access to topologies, live experiments, and metric reports');

INSERT IGNORE INTO permissions (id, description) VALUES
    ('topology:read', 'View worlds, topologies, services, and edges'),
    ('topology:write', 'Create, update, or delete topologies and service graphs'),
    ('experiments:read', 'View experiment definitions, live metrics, and run history'),
    ('experiments:run', 'Start, stop, and execute experiments'),
    ('faults:inject', 'Inject and disarm faults and manipulate circuit breakers'),
    ('chaos:abort', 'Trigger emergency chaos kill-switch'),
    ('audit:read', 'View the tamper-evident audit ledger'),
    ('users:manage', 'Manage user accounts, roles, and session revocations');

-- Viewer role permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('VIEWER', 'topology:read'),
    ('VIEWER', 'experiments:read');

-- Operator role permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('OPERATOR', 'topology:read'),
    ('OPERATOR', 'topology:write'),
    ('OPERATOR', 'experiments:read'),
    ('OPERATOR', 'experiments:run'),
    ('OPERATOR', 'faults:inject'),
    ('OPERATOR', 'chaos:abort');

-- Admin role permissions (all 8 permissions)
INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('ADMIN', 'topology:read'),
    ('ADMIN', 'topology:write'),
    ('ADMIN', 'experiments:read'),
    ('ADMIN', 'experiments:run'),
    ('ADMIN', 'faults:inject'),
    ('ADMIN', 'chaos:abort'),
    ('ADMIN', 'audit:read'),
    ('ADMIN', 'users:manage');
