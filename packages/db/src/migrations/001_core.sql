-- 001_core.sql: Organizations, Users, Sessions, and Worlds

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Organization membership
CREATE TABLE IF NOT EXISTS organization_members (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       INTEGER NOT NULL,
  UNIQUE(organization_id, user_id)
);

-- Sessions (server-side state; token hash is in cookie)
CREATE TABLE IF NOT EXISTS sessions (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  last_seen_at    INTEGER NOT NULL,
  ip_address      TEXT,
  user_agent      TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions (user_id);

-- Worlds
CREATE TABLE IF NOT EXISTS worlds (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'IDLE'
                  CHECK (status IN ('IDLE','CONFIGURING','READY','RUNNING','PAUSED',
                                    'STOPPING','STOPPED','FAILED','ARCHIVED')),
  runtime_mode    TEXT NOT NULL DEFAULT 'LOGICAL'
                  CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  event_seq       BLOB NOT NULL DEFAULT 0,
  created_by      TEXT NOT NULL REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS worlds_org_status_idx ON worlds (organization_id, status);
CREATE INDEX IF NOT EXISTS worlds_org_name_idx   ON worlds (organization_id, name);
