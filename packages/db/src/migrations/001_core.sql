-- 001_core.sql: Organizations, Users, Sessions, and Worlds

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_email_idx ON users (email);

-- Organization membership
CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- Sessions (server-side state; token hash is in cookie)
CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address      INET,
  user_agent      TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions (token_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS sessions_user_id_idx    ON sessions (user_id);

-- Worlds
CREATE TABLE IF NOT EXISTS worlds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'IDLE'
                  CHECK (status IN ('IDLE','CONFIGURING','READY','RUNNING','PAUSED',
                                    'STOPPING','STOPPED','FAILED','ARCHIVED')),
  runtime_mode    TEXT NOT NULL DEFAULT 'LOGICAL'
                  CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  event_seq       BIGINT NOT NULL DEFAULT 0,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS worlds_org_status_idx ON worlds (organization_id, status);
CREATE INDEX IF NOT EXISTS worlds_org_name_idx   ON worlds (organization_id, name);
