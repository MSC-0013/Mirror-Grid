-- 001_core.sql: Organizations, Users, Sessions, and Worlds

-- Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id                 VARCHAR(36) PRIMARY KEY,
  name               VARCHAR(255) NOT NULL,
  slug               VARCHAR(255) NOT NULL UNIQUE,
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Users
CREATE TABLE IF NOT EXISTS users (
  id                 VARCHAR(36) PRIMARY KEY,
  email              VARCHAR(255) NOT NULL UNIQUE,
  password_hash      VARCHAR(64) NOT NULL,
  display_name       VARCHAR(255) NOT NULL,
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX users_email_idx ON users (email);

-- Organization membership
CREATE TABLE IF NOT EXISTS organization_members (
  id                 VARCHAR(36) PRIMARY KEY,
  organization_id    VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id            VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at          DATETIME(3) NOT NULL,
  UNIQUE(organization_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Sessions (server-side state; token hash is in cookie)
CREATE TABLE IF NOT EXISTS sessions (
  id                 VARCHAR(36) PRIMARY KEY,
  user_id            VARCHAR(36) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash         VARCHAR(64) NOT NULL UNIQUE,
  expires_at         DATETIME(3) NOT NULL,
  created_at         DATETIME(3) NOT NULL,
  last_seen_at       DATETIME(3) NOT NULL,
  ip_address         VARCHAR(255),
  user_agent         TEXT,
  is_active          INT NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX sessions_token_hash_idx ON sessions (token_hash);
CREATE INDEX sessions_user_id_idx    ON sessions (user_id);

-- Worlds
CREATE TABLE IF NOT EXISTS worlds (
  id                 VARCHAR(36) PRIMARY KEY,
  organization_id    VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name               VARCHAR(255) NOT NULL,
  description        TEXT,
  status             VARCHAR(255) NOT NULL DEFAULT 'IDLE'
                  CHECK (status IN ('IDLE','CONFIGURING','READY','RUNNING','PAUSED',
                                    'STOPPING','STOPPED','FAILED','ARCHIVED')),
  runtime_mode       VARCHAR(255) NOT NULL DEFAULT 'LOGICAL'
                  CHECK (runtime_mode IN ('LOGICAL','CONTAINER','HYBRID')),
  event_seq          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_by         VARCHAR(36) NOT NULL REFERENCES users(id),
  created_at         DATETIME(3) NOT NULL,
  updated_at         DATETIME(3) NOT NULL,
  UNIQUE (organization_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE INDEX worlds_org_status_idx ON worlds (organization_id, status);
CREATE INDEX worlds_org_name_idx   ON worlds (organization_id, name);
