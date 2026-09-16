# M06 — Security: RBAC, Audit Logging, and Adaptive Rate Limiting

## 1. Context

As a distributed-systems laboratory, MIRRORGRID provides operators with potent capabilities: injecting
network partitions, modifying service latencies, altering circuit breaker parameters, and triggering
emergency chaos aborts. In an enterprise or multi-tenant setting, uncontrolled access to these levers
is catastrophic. A viewer must never be able to trip a production-mode circuit, and an operator's actions
must leave an unalterable, forensic record.

Following the architectural decision documented in M00 (ADR-001), MIRRORGRID avoids stateless JWTs
in favor of **stateful, revocable sessions** backed by Redis and Postgres.

This milestone establishes the security foundation of the platform:

1. **Granular Role-Based Access Control (RBAC):** Hierarchical permissions governing every API endpoint.
2. **Cryptographically Chained Audit Trail:** An append-only, tamper-evident audit ledger capturing every
   mutating action, before/after JSON diffs, and cryptographic hash links.
3. **Adaptive Rate Limiting:** Dynamic token-bucket admission control protecting the API Gateway and
   Control Plane against abusive bursts, brute force attacks, and noisy neighbors.

---

## 2. Prerequisites

- M00 green (`verify:m0` — walking skeleton & baseline auth)
- M05 green (`verify:flagship` — Tier 1 core completed)
- Docker Compose profile: `--profile core` (Postgres and Redis)

---

## 3. Scope

### In scope

- Password hashing using Argon2id with OWASP-recommended memory and time cost parameters.
- Session lifecycle: secure HTTP-only cookies, Redis session caching, instant cross-device revocation,
  and CSRF double-submit token protection.
- RBAC model: `ADMIN`, `OPERATOR`, and `VIEWER` roles with explicit permission codes (e.g. `faults:inject`,
  `chaos:abort`, `topology:write`, `audit:read`).
- Fastify authorization decorators enforcing permissions at route registration time.
- Tamper-evident Audit Ledger: Sequenced audit records linked via SHA-256 hash chains (`prev_hash`).
- Adaptive Rate Limiting: Token bucket algorithm with penalty multipliers on consecutive client errors.
- Database migration `007_security.sql`: users, user_sessions, roles, permissions, role_permissions,
  user_roles, and audit_logs.
- UI: Team management roster, role assignment modal, active sessions inspector, and Audit Trail Explorer (§70, §71).

### Explicitly out of scope

- Third-party SSO / SAML 2.0 / OpenID Connect federation (deferred to future enterprise plugins).
- Attribute-Based Access Control (ABAC) or Open Policy Agent (OPA) policy engines.
- Database column-level field encryption (Postgres tables are protected via database-level encryption at rest).

---

## 4. Design

### Session Auth vs JWT (ADR-001 Reinforcement)

Stateless JWTs suffer from a critical flaw in security-sensitive systems: **they cannot be revoked instantly**.
If an operator's role is demoted or their credentials are compromised, an active JWT remains valid
until its expiration unless complex, distributed blacklists are maintained.

MIRRORGRID employs server-managed sessions:

1. Client presents a 256-bit cryptographically random session token via an `HttpOnly`, `SameSite=Lax`,
   `Secure` cookie.
2. The database and Redis cache store the SHA-256 hash of the token (preventing token theft if the
   session table is leaked).
3. Session checks hit Redis with sub-millisecond latency. Revoking a session or banning a user deletes
   the session key in Redis, immediately terminating access on the very next HTTP request.

### The Cryptographic Audit Hash Chain

To provide verifiable integrity, every mutating action records an audit entry into an append-only table.
Each entry links to the previous entry via a cryptographic hash:

```
+--------------------------+          +--------------------------+
|      Audit Entry #1      |          |      Audit Entry #2      |
|  seq: 1                  |          |  seq: 2                  |
|  prev_hash: 'GENESIS'    | <------- |  prev_hash: SHA256(#1)   |
|  action: 'WORLD_CREATE'  |          |  action: 'FAULT_INJECT'  |
|  record_hash: 0x4a1f...  |          |  record_hash: 0x8b3c...  |
+--------------------------+          +--------------------------+
```

$$\text{record\_hash} = \text{SHA-256}\Big(\text{prev\_hash} \,||\, \text{seq} \,||\, \text{timestamp} \,||\, \text{userId} \,||\, \text{action} \,||\, \text{resourceId} \,||\, \text{payloadHash}\Big)$$

If an attacker with database access alters a past audit record, deletes an entry, or inserts an entry,
the cryptographic chain breaks. The verification job (`verify:m6`) scans the entire ledger and proves
its mathematical integrity.

### RBAC Permission Matrix

| Permission Code    | Description                                 | Viewer | Operator | Admin |
| ------------------ | ------------------------------------------- | :----: | :------: | :---: |
| `topology:read`    | View worlds, services, and edges            |  Yes   |   Yes    |  Yes  |
| `topology:write`   | Create, edit, and delete topologies         |   No   |   Yes    |  Yes  |
| `experiments:read` | View experiments, live metrics, and reports |  Yes   |   Yes    |  Yes  |
| `experiments:run`  | Start, stop, and configure experiments      |   No   |   Yes    |  Yes  |
| `faults:inject`    | Inject faults and modify circuit breakers   |   No   |   Yes    |  Yes  |
| `chaos:abort`      | Trigger emergency chaos kill-switch         |   No   |   Yes    |  Yes  |
| `audit:read`       | Inspect audit ledger and security logs      |   No   |    No    |  Yes  |
| `users:manage`     | Invite users, assign roles, revoke sessions |   No   |    No    |  Yes  |

### Adaptive Rate Limiting

Rate limiting uses the `TokenBucket` algorithm from `packages/reliability/src/core/token-bucket.ts`
adapted to Redis via Lua scripting:

- **Baseline Allowance:** 100 requests per minute per IP / User for standard endpoints; 20 req/min for auth routes.
- **Adaptive Penalty:** If a client triggers 5 consecutive `401 Unauthorized`, `403 Forbidden`, or `429 Too Many Requests`
  responses within 30 seconds, their IP is flagged with an adaptive penalty: their token refill rate is
  quartered (4x slower) for a 15-minute cooldown period.
- **Header Standard:** Responses include RFC 6585 headers: `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`,
  and `Retry-After` upon 429.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/007_security.sql`:

```sql
-- 007_security.sql: Authentication, RBAC, session management, and tamper-evident audit ledger

-- 1. Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL, -- Argon2id hash string
    display_name VARCHAR(120) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, SUSPENDED, DEACTIVATED
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- 2. User sessions (hashed session tokens)
CREATE TABLE user_sessions (
    id VARCHAR(64) PRIMARY KEY, -- SHA-256 hash of plaintext cookie token
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX idx_user_sessions_expiry ON user_sessions(expires_at);

-- 3. Roles and Permissions
CREATE TABLE roles (
    id VARCHAR(50) PRIMARY KEY, -- ADMIN, OPERATOR, VIEWER
    description TEXT NOT NULL
);

CREATE TABLE permissions (
    id VARCHAR(100) PRIMARY KEY, -- e.g. 'faults:inject', 'topology:write'
    description TEXT NOT NULL
);

CREATE TABLE role_permissions (
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id VARCHAR(100) NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id VARCHAR(50) NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

-- 4. Tamper-evident append-only Audit Ledger
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seq_num BIGSERIAL NOT NULL UNIQUE,
    prev_hash VARCHAR(64) NOT NULL,
    record_hash VARCHAR(64) NOT NULL UNIQUE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_email VARCHAR(255) NOT NULL,
    action VARCHAR(100) NOT NULL, -- e.g. 'FAULT_INJECTED', 'CHAOS_ABORT', 'USER_ROLE_UPDATED'
    resource_type VARCHAR(50) NOT NULL, -- 'WORLD', 'FAULT', 'EXPERIMENT', 'USER'
    resource_id VARCHAR(120) NOT NULL,
    diff_json JSONB NOT NULL DEFAULT '{}'::jsonb, -- { "before": {...}, "after": {...} }
    client_ip VARCHAR(45) NOT NULL,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_seq ON audit_logs(seq_num ASC);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC);
```

### Seed Data (Initial Roles and Permissions)

```sql
INSERT INTO roles (id, description) VALUES
    ('ADMIN', 'Full administrative access to the platform, security, and audit logs'),
    ('OPERATOR', 'Can create topologies, configure and run experiments, and inject faults'),
    ('VIEWER', 'Read-only access to topologies, live experiments, and metric reports');

INSERT INTO permissions (id, description) VALUES
    ('topology:read', 'View worlds, topologies, services, and edges'),
    ('topology:write', 'Create, update, or delete topologies and service graphs'),
    ('experiments:read', 'View experiment definitions, live metrics, and run history'),
    ('experiments:run', 'Start, stop, and execute experiments'),
    ('faults:inject', 'Inject and disarm faults and manipulate circuit breakers'),
    ('chaos:abort', 'Trigger emergency chaos kill-switch'),
    ('audit:read', 'View the tamper-evident audit ledger'),
    ('users:manage', 'Manage user accounts, roles, and session revocations');

-- Viewer permissions
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('VIEWER', 'topology:read'),
    ('VIEWER', 'experiments:read');

-- Operator permissions
INSERT INTO role_permissions (role_id, permission_id) VALUES
    ('OPERATOR', 'topology:read'),
    ('OPERATOR', 'topology:write'),
    ('OPERATOR', 'experiments:read'),
    ('OPERATOR', 'experiments:run'),
    ('OPERATOR', 'faults:inject'),
    ('OPERATOR', 'chaos:abort');

-- Admin permissions (all)
INSERT INTO role_permissions (role_id, permission_id)
SELECT 'ADMIN', id FROM permissions;
```

---

## 6. Packages

```
packages/security/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public exports
│   ├── auth/
│   │   ├── argon2.ts                # Password hashing and verification
│   │   ├── session-store.ts         # Redis & Postgres session lifecycle
│   │   └── csrf.ts                  # Double-submit cookie CSRF validation
│   ├── rbac/
│   │   ├── permissions.ts           # Permission enum and role definitions
│   │   └── authorizer.ts            # Fastify preHandler permission guard
│   ├── audit/
│   │   ├── audit-logger.ts          # Append-only audit writer
│   │   └── hash-chain.ts            # SHA-256 chain verification engine
│   └── ratelimit/
│       ├── limiter.ts               # Redis token-bucket rate limiter plugin
│       └── adaptive.ts              # Error-rate penalty multiplier
packages/db/
├── src/
│   ├── schema/
│   │   └── security.ts              # Drizzle schema matching 007_security.sql
│   └── migrations/
│       └── 007_security.sql         # Migration DDL above
apps/control/
├── src/
│   ├── plugins/
│   │   ├── auth.plugin.ts           # Fastify session authentication decorator
│   │   ├── rbac.plugin.ts           # Route-level authorization decorator
│   │   └── ratelimit.plugin.ts      # Adaptive rate limiter hook
│   └── modules/
│       ├── auth/
│       │   ├── auth.routes.ts       # /login, /logout, /me, /sessions
│       │   └── auth.service.ts
│       ├── users/
│       │   ├── user.routes.ts       # User management and role assignment
│       │   └── user.service.ts
│       └── audit/
│           ├── audit.routes.ts      # /audit-logs endpoint with pagination & verify
│           └── audit.service.ts
apps/web/
├── src/
│   └── app/
│       └── settings/
│           ├── team/
│           │   └── page.tsx         # User roster & role editor (§71)
│           └── audit/
│               └── page.tsx         # Tamper-evident Audit Ledger Explorer (§70)
```

---

## 7. Interfaces

### Security & Principal Contracts

```typescript
// packages/security/src/rbac/permissions.ts

export type PermissionCode =
  | 'topology:read'
  | 'topology:write'
  | 'experiments:read'
  | 'experiments:run'
  | 'faults:inject'
  | 'chaos:abort'
  | 'audit:read'
  | 'users:manage';

export type RoleCode = 'ADMIN' | 'OPERATOR' | 'VIEWER';

export interface UserPrincipal {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly RoleCode[];
  readonly permissions: ReadonlySet<PermissionCode>;
  readonly sessionId: string;
}

export interface Authorizer {
  hasPermission(principal: UserPrincipal, required: PermissionCode): boolean;
  hasRole(principal: UserPrincipal, role: RoleCode): boolean;
}
```

### Audit Ledger Contract

```typescript
// packages/security/src/audit/audit-logger.ts

export interface AuditEntryInput {
  readonly principal: UserPrincipal;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly diff?: {
    readonly before?: unknown;
    readonly after?: unknown;
  };
  readonly clientIp: string;
  readonly userAgent?: string;
}

export interface AuditRecord {
  readonly seqNum: bigint;
  readonly prevHash: string;
  readonly recordHash: string;
  readonly userId: string;
  readonly userEmail: string;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly diffJson: Record<string, unknown>;
  readonly clientIp: string;
  readonly createdAt: Date;
}

export interface AuditLogger {
  log(entry: AuditEntryInput): Promise<AuditRecord>;
  verifyChain(
    fromSeq?: bigint,
    toSeq?: bigint,
  ): Promise<{ readonly valid: boolean; readonly brokenSeq?: bigint }>;
}
```

---

## 8. API

Routes in `apps/control` under `/api/v1`.

### 1. User Login

- `POST /api/v1/auth/login`
- **Request Body (zod schema):**
  ```typescript
  export const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
  });
  ```
- **Response:** `200 OK` with User profile; sets `mg_session` HttpOnly cookie.

### 2. User Logout & Session Revocation

- `POST /api/v1/auth/logout`
- **Response:** `200 OK`; clears `mg_session` cookie; deletes session from Redis & DB.
- `POST /api/v1/auth/sessions/:sessionId/revoke` (Revoke specific device)
- `POST /api/v1/auth/sessions/revoke-all` (Revoke all sessions except current)

### 3. Assign User Role

- `PUT /api/v1/users/:id/roles`
- **Authorization:** Requires `users:manage` (ADMIN only).
- **Request Body:** `{ roles: ['OPERATOR'] }`
- **Response:** `200 OK` with updated user profile. Creates Audit Record.

### 4. Query Audit Ledger

- `GET /api/v1/audit-logs`
- **Authorization:** Requires `audit:read` (ADMIN only).
- **Query Params:** `page=1&limit=50&resourceType=WORLD&action=FAULT_INJECT`
- **Response:** `200 OK` with `{ data: AuditRecord[], pagination: {...}, chainValid: true }`.

---

## 9. UI

### 1. Audit Trail Explorer (`apps/web/src/app/settings/audit/page.tsx`)

- **Spec alignment:** §70 (Tamper-Evident Audit Explorer).
- **Layout:**
  - Header: "Audit & Security Ledger" with live **"Hash Chain: VERIFIED"** badge (green lock icon).
  - Search & Filter Bar: Filter by actor email, action type, resource ID, and date range.
  - Audit Table:
    - Columns: Timestamp, Seq #, Actor, Action (badge colored by severity: Red for abort, Amber for fault inject, Blue for config),
      Target Resource, Client IP, Details button.
  - Diff Drawer: Expanding a row opens a JSON Delta view with highlighted additions (green) and deletions (red).
  - Chain Verification Button: "Run Mathematical Verification" button that recalculates all SHA-256 hashes from genesis.

### 2. Team & Access Control (`apps/web/src/app/settings/team/page.tsx`)

- **Spec alignment:** §71 (User Roster & Access Management).
- **Layout:**
  - User list table showing name, email, assigned roles, status, and last active timestamp.
  - "Invite User" modal with role picker.
  - Active Sessions modal showing current IP, browser, and "Revoke Session" button.

---

## 10. Steps

1. **Create `packages/security` package:** Scaffold directory, dependencies (`argon2`, `ioredis`), and tsconfig.
2. **Implement Argon2id password hashing:** Write `src/auth/argon2.ts` with OWASP-recommended parameters.
3. **Build Session Store:** Implement Redis caching and Postgres persistence in `src/auth/session-store.ts`.
4. **Build RBAC Authorizer:** Implement permission matrix and Fastify preHandler hook.
5. **Implement Cryptographic Audit Hash Chain:** Build `src/audit/hash-chain.ts` with SHA-256 record hashing.
6. **Implement Adaptive Rate Limiter:** Build Redis token bucket plugin with error-penalty escalation.
7. **Database migration `007_security.sql`:** Add tables, indexes, and seed initial roles/permissions.
8. **Build Control Plane Auth & User modules:** Register routes for login, logout, session management, and role assignment.
9. **Build Audit Log API module:** Implement paginated ledger querying and chain verification endpoint.
10. **Build Team Management UI:** Implement `apps/web/src/app/settings/team/page.tsx`.
11. **Build Audit Explorer UI:** Implement `apps/web/src/app/settings/audit/page.tsx` with JSON diff viewer.
12. **Implement `npm run verify:m6` gate script:** Automated test suite validating all 5 security assertions.

---

## 11. Testing

### Unit tests (`packages/security/tests/unit`)

- `argon2.test.ts`: Verify password hashing and rejection of invalid passwords.
- `hash-chain.test.ts`:
  - Assert 100 consecutive records produce a valid mathematical chain.
  - Tamper with record #42 payload; assert verification detects corruption at sequence #42.
- `token-bucket.test.ts`: Assert rate limit drops requests when bucket is empty and refills accurately over time.

### Integration tests (`apps/control/tests/integration/security`)

- `rbac-guard.test.ts`:
  - Authenticate as `VIEWER`; assert `POST /faults` returns 403 Forbidden with `AppError.forbidden()`.
  - Authenticate as `OPERATOR`; assert `POST /faults` succeeds with 200 OK.
- `session-revocation.test.ts`: Log in, revoke session, assert immediate 401 on next request.
- `audit-logging.test.ts`: Perform mutating actions and assert audit records are inserted with valid sequence numbers and hashes.

---

## 12. Gate

Command: `npm run verify:m6`

The gate test executes the following automated checks:

```typescript
// tests/gates/verify-m6.ts

// Assertion 1: Session revocation is immediate across all endpoints
assert(sessionRevokedImmediately, 'Assertion 1: Revoked session receives immediate 401');

// Assertion 2: RBAC permissions strictly forbid unauthorized actions
assert(
  viewerBlockedFromFaultInjection,
  'Assertion 2: VIEWER role cannot inject faults (403 Forbidden)',
);

// Assertion 3: Cryptographic Audit Hash Chain verifies 100% intact from genesis
assert(chainIntegrityVerified, 'Assertion 3: Audit ledger hash chain is mathematically intact');

// Assertion 4: Tampering with audit record payload is immediately detected
assert(tamperDetectedAtSequence, 'Assertion 4: Audit tampering detected at exact sequence number');

// Assertion 5: Adaptive rate limiter throttles abusive traffic and returns RFC 6585 headers
assert(rateLimiterThrottlesAbuse, 'Assertion 5: Adaptive rate limiter throttles abuse with 429');
```

---

## 13. Pitfalls

1. **Storing plaintext session tokens in Redis or DB:** If Redis is inspected or dumped, tokens can be stolen.
   Always store `SHA256(token)` in storage and only transmit the plaintext token in the cookie.
2. **Missing audit records on failed mutating attempts:** Security auditors want to know who _attempted_
   unauthorized actions as well as who succeeded. Log both.
3. **Audit chain concurrency race:** Multiple concurrent transactions writing audit logs can conflict on `seq_num`
   or `prev_hash`. Use Postgres advisory locks (`pg_advisory_xact_lock`) around audit hash generation.
4. **Leaking user enumeration in login errors:** Never return "User not found" vs "Invalid password".
   Always return generic "Invalid email or password" to prevent user enumeration attacks.

---

## 14. Done

- [ ] `packages/security` compiles under strict TypeScript with zero type errors.
- [ ] Argon2id password hashing implemented with OWASP parameters.
- [ ] Session authentication supports instant revocation and CSRF protection.
- [ ] RBAC authorizer enforces permissions across all Control Plane API routes.
- [ ] Audit ledger records mutating actions and passes cryptographic hash chain verification.
- [ ] Adaptive rate limiter throttles abusive traffic with RFC 6585 compliance.
- [ ] Migration `007_security.sql` applied cleanly with seed data.
- [ ] Team management and Audit Explorer screens functional in UI.
- [ ] `npm run verify:m6` runs green in CI with all 5 gate assertions passing.
