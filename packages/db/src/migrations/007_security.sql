-- 007_security.sql: Authentication, RBAC, session management, and tamper-evident audit ledger

-- 1. Extend users table with status if not present
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE';

-- 2. Roles and Permissions tables
CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permissions (
    id TEXT PRIMARY KEY,
    description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS user_roles (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- 3. Tamper-evident append-only Audit Ledger
CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    seq_num INTEGER NOT NULL UNIQUE,
    prev_hash TEXT NOT NULL,
    record_hash TEXT NOT NULL UNIQUE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    diff_json TEXT NOT NULL DEFAULT '{}',
    client_ip TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_seq ON audit_logs(seq_num ASC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON audit_logs(created_at DESC);

-- 4. Initial Seed Data
INSERT OR IGNORE INTO roles (id, description) VALUES
    ('ADMIN', 'Full administrative access to the platform, security, and audit logs'),
    ('OPERATOR', 'Can create topologies, configure and run experiments, and inject faults'),
    ('VIEWER', 'Read-only access to topologies, live experiments, and metric reports');

INSERT OR IGNORE INTO permissions (id, description) VALUES
    ('topology:read', 'View worlds, topologies, services, and edges'),
    ('topology:write', 'Create, update, or delete topologies and service graphs'),
    ('experiments:read', 'View experiment definitions, live metrics, and run history'),
    ('experiments:run', 'Start, stop, and execute experiments'),
    ('faults:inject', 'Inject and disarm faults and manipulate circuit breakers'),
    ('chaos:abort', 'Trigger emergency chaos kill-switch'),
    ('audit:read', 'View the tamper-evident audit ledger'),
    ('users:manage', 'Manage user accounts, roles, and session revocations');

-- Viewer role permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('VIEWER', 'topology:read'),
    ('VIEWER', 'experiments:read');

-- Operator role permissions
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('OPERATOR', 'topology:read'),
    ('OPERATOR', 'topology:write'),
    ('OPERATOR', 'experiments:read'),
    ('OPERATOR', 'experiments:run'),
    ('OPERATOR', 'faults:inject'),
    ('OPERATOR', 'chaos:abort');

-- Admin role permissions (all 8 permissions)
INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES
    ('ADMIN', 'topology:read'),
    ('ADMIN', 'topology:write'),
    ('ADMIN', 'experiments:read'),
    ('ADMIN', 'experiments:run'),
    ('ADMIN', 'faults:inject'),
    ('ADMIN', 'chaos:abort'),
    ('ADMIN', 'audit:read'),
    ('ADMIN', 'users:manage');
