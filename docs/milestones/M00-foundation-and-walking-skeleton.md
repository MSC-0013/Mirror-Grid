# M00 — Foundation and Walking Skeleton

## 1. Context

Nothing ships without this. M00 establishes:

- The monorepo shape every other milestone adds to
- CI that is the project's immune system: typecheck, lint, unit, integration, contract, gitleaks,
  the no-mock-data assertion
- A real vertical slice: login → create World → list Worlds → backed by a real API and Postgres

The "walking skeleton" name is precise: the system walks (end-to-end flow works) but does not yet
run (no simulation, no faults, no events). Every later milestone adds capability to a working
foundation rather than constructing one mid-flight.

**Why this ordering matters:** infrasight's failure mode was building 19k LOC of UI on top of a
backend whose routes imported `mock-data.ts` (1,178 lines). The walking skeleton is the
countermeasure — the frontend cannot render a screen whose endpoint does not exist.

---

## 2. Prerequisites

- None — this is the root milestone.
- Docker Desktop running: `docker desktop start`
- Compose profile to start: `--profile core` (PostgreSQL 18 only)

---

## 3. Scope

### In scope

- Turborepo monorepo with npm workspaces
- Full root configuration: tsconfig, ESLint, Prettier, editorconfig, gitignore, CLAUDE.md, .env.example
- GitHub Actions CI (PR suite)
- docker-compose.yml defining ALL services (core profile only active)
- packages/config, packages/logging, packages/validation, packages/platform, packages/db
- apps/gateway (Fastify 5, OpenAPI 3.1, auth boundary)
- apps/control (auth module + worlds module, full six-file shape)
- apps/web (Next.js 16, login, app shell, dashboard, worlds list, create-world modal)
- Session-based auth (server-side Postgres sessions, HTTP-only cookie)
- Migration 001_core.sql

### Explicitly out of scope

- Redis, Kafka, NATS, OpenSearch, MinIO, Prometheus, Grafana, Jaeger, OTel, Toxiproxy
  (none of these start at M0; the compose file defines them but they are inactive)
- Simulation engine (M2)
- Services, dependencies, workloads tables (M1)
- Any screen whose API does not exist in this milestone

---

## 4. Design

### Auth: Server-side sessions, not JWT

**Decision:** Session tokens stored in Postgres `sessions` table; HTTP-only `SameSite=Lax` cookie.
**Rationale:** Spec §55 requires logout invalidation and session rotation. Stateless JWTs cannot do
this without a revocation store — which is a session store with extra steps. Argon2id for password
hashing (bcrypt's cost factor is not memory-hard; argon2id is the 2023 OWASP recommendation).
**Rejected:** JWT with Redis revocation list (adds Redis as M0 dependency; Redis is M6).

### Compose: define-all, start-one

The compose file defines every service with healthchecks, `depends_on: service_healthy`,
`${VAR:-default}` interpolation and `mem_limit`. Only the `core` profile (PostgreSQL) starts at M0.
**Rationale:** prevents enum-only fake integrations (Pulse listed kafka/nats as enum values with no
broker). When M8 turns on the `events` profile, Kafka is already correctly defined.

### Health semantics (defined here, consumed by all later milestones)

| Probe            | Question                                     | Fails when                                                                  |
| ---------------- | -------------------------------------------- | --------------------------------------------------------------------------- |
| `/health/live`   | Is the process alive?                        | Event loop wedged, unrecoverable state. NEVER because a dependency is down. |
| `/health/ready`  | Can this service perform its role right now? | A REQUIRED dependency is unavailable                                        |
| `/health/status` | What is each dependency's state?             | Never — it reports, it does not fail                                        |

A `degraded` dependency going down moves `/health/status` to DEGRADED and leaves readiness green.
This is the §78 partial-failure behaviour and it is impossible to retrofit after M0.

### OpenAPI as source of truth

`fastify-type-provider-zod@7` + `@fastify/swagger` emit OpenAPI 3.1 at `/openapi.json`.
This JSON is committed to `schemas/api/openapi.json`. A CI contract test asserts the served spec
matches the committed one — so drift fails CI. Frontend types are generated from that spec, which
is what makes the no-mock rule cheap rather than laborious.

### Dependency-cruiser enforcement (from day one)

`packages/sim` and `packages/reliability` may not import any other workspace package.
`domain` may import them. Apps may import anything.
ESLint `no-restricted-imports` bans framework imports inside `packages/sim` and `packages/reliability`.

---

## 5. Data Model

### Migration 001_core.sql

```sql
-- Organizations
CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX users_email_idx ON users (email);

-- Organization membership
CREATE TABLE organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- Sessions (server-side; token is HTTP-only cookie)
CREATE TABLE sessions (
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

CREATE INDEX sessions_token_hash_idx ON sessions (token_hash) WHERE is_active = true;
CREATE INDEX sessions_user_id_idx    ON sessions (user_id);

-- Worlds
CREATE TABLE worlds (
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
  UNIQUE(organization_id, name)
);

CREATE INDEX worlds_org_status_idx ON worlds (organization_id, status);
```

**Index rationale:**

- `sessions_token_hash_idx` is partial (`WHERE is_active = true`) so the hot auth path never scans
  expired sessions. The `sessions` table grows without the lookup slowing down.
- `worlds_org_status_idx` covers the dashboard list query (`WHERE organization_id = $1`).
- `event_seq` on the `worlds` row is the per-world monotonic counter used from M8 onward.
  Defined here so the column exists before the constraint is needed.

---

## 6. Packages

### packages/config

```
src/
  env.ts        zod safeParse of process.env -> frozen config export.
                process.exit(1) on failure with a clear message.
  index.ts      re-export config
```

### packages/logging

```
src/
  logger.ts     pino 10 factory: level from config, serializers for req/res,
                always includes { traceId, requestId, service } fields (spec §81).
  index.ts
```

### packages/validation

```
src/
  schemas/
    pagination.ts   page/limit/cursor zod schemas
    id.ts           UUID schema with refinement
  index.ts
```

### packages/platform

```
src/
  health/
    types.ts          HealthStatus, DependencyHealth, ServiceHealth interfaces
    probe.ts          HealthProbe class: liveness, readiness, status endpoints
  correlation/
    types.ts          CorrelationContext: requestId, traceId, sessionId, userId
    context.ts        AsyncLocalStorage-based context propagation
  index.ts
```

### packages/db

```
src/
  client.ts         postgres.js connection (from config)
  drizzle.ts        Drizzle instance over the postgres.js client
  migrate.ts        run migrations from packages/db/migrations/
  index.ts
migrations/
  001_core.sql      (see Data model above)
drizzle.config.ts
```

### apps/gateway

```
src/
  app.ts                Fastify factory: request-id plugin, CORS, error handler,
                        @fastify/swagger (OpenAPI 3.1), route registration
  plugins/
    request-id.ts       X-Request-ID middleware, populates correlation context
    error-handler.ts    Maps AppError codes to HTTP; never leaks SQL/stack
    auth.ts             Session cookie validation, populates req.user
  routes/
    health.ts           /health/live, /health/ready, /health/status
    openapi.ts          /openapi.json passthrough
  server.ts             Entry point: create app, listen
  index.ts
```

### apps/control

```
src/
  core/
    errors/
      app-error.ts          Static factories: AppError.notFound(), .forbidden(), etc.
      error-codes.ts        Enum of all application error codes
    utils/
      response.ts           { success, data, meta } wrapper
      pagination.ts         cursor/page pagination helpers
    middleware/
      auth.middleware.ts    requireAuth: validates session from cookie
  modules/
    auth/
      auth.routes.ts        POST /auth/login, POST /auth/logout, GET /auth/me
      auth.controller.ts
      auth.service.ts       login(email, pw) -> session, logout(token), me(userId)
      auth.repository.ts    findUserByEmail, createSession, deleteSession, findSession
      auth.schema.ts        loginBody zod schema
      index.ts
    worlds/
      worlds.routes.ts      GET /worlds, POST /worlds, GET /worlds/:id, PATCH /worlds/:id, DELETE /worlds/:id
      worlds.controller.ts
      worlds.service.ts     CRUD + status validation
      worlds.repository.ts  findAll(orgId), findById, create, update, delete
      worlds.schema.ts      createWorldBody, updateWorldBody zod schemas
      index.ts
  app.ts                    Fastify sub-app registering all module routes under /api/v1
  server.ts
```

### apps/web

```
src/
  app/
    (auth)/
      login/
        page.tsx            Login form (spec §7 — auth screen)
    (app)/
      layout.tsx            App shell: sidebar (§8), topbar (§10), status bar (§12)
      page.tsx              Dashboard (§13–14): world count, active experiments, system status
      worlds/
        page.tsx            Worlds list (§15): cards, status badges, search, create button
        _components/
          world-card.tsx
          create-world-modal.tsx   Modal with name/description/runtime-mode (§16)
  components/
    ui/                     Primitive components: Button, Input, Badge, Modal, Spinner,
                            Toast, EmptyState, ErrorState, LoadingState
    layout/
      sidebar.tsx           Navigation items, status indicator
      topbar.tsx            Breadcrumbs, user menu
      system-status.tsx     §12: overall health banner
  lib/
    api/
      client.ts             fetch wrapper with requestId, error parsing
      worlds.ts             getWorlds(), createWorld(), getWorld(), updateWorld()
      auth.ts               login(), logout(), me()
    types/
      generated/            (output of openapi-typescript from /openapi.json)
  styles/
    globals.css
    tokens.css              CSS custom properties: colors, spacing, radius, typography
```

---

## 7. Interfaces

### HealthProbe (packages/platform)

```typescript
// packages/platform/src/health/types.ts
export type DependencyStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN';
export type ServiceStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface DependencyHealth {
  name: string;
  required: boolean;
  status: DependencyStatus;
  latencyMs?: number;
  error?: string;
}

export interface ServiceHealthReport {
  service: string;
  status: ServiceStatus;
  version: string;
  uptime: number;
  dependencies: DependencyHealth[];
  checkedAt: string; // ISO 8601, PLATFORM_WALL time
}
```

### Config (packages/config)

```typescript
// packages/config/src/env.ts
export interface AppConfig {
  readonly nodeEnv: 'development' | 'production' | 'test';
  readonly port: number;
  readonly databaseUrl: string;
  readonly sessionSecret: string;
  readonly serviceName: string;
  readonly logLevel: string;
}
// Exported as: export const config: Readonly<AppConfig>
```

### AppError (apps/control core)

```typescript
// apps/control/src/core/errors/app-error.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly message: string,
    public readonly statusCode: number,
    public readonly details?: unknown,
  ) {
    super(message);
  }

  static notFound(resource: string, id?: string): AppError;
  static forbidden(action: string): AppError;
  static badRequest(message: string, details?: unknown): AppError;
  static conflict(message: string): AppError;
  static internal(message: string): AppError;
}
```

---

## 8. API

All routes are behind `/api/v1` except `/health/*` and `/openapi.json`.

### Auth

```
POST   /api/v1/auth/login       loginBody: { email, password }
                                 -> 200 { user } + Set-Cookie: session=...; HttpOnly; SameSite=Lax
POST   /api/v1/auth/logout      -> 204; clears cookie; invalidates session row
GET    /api/v1/auth/me          -> 200 { id, email, displayName, organizationId }
```

### Worlds

```
GET    /api/v1/worlds           ?page&limit -> 200 { data: World[], meta: PaginationMeta }
POST   /api/v1/worlds           createWorldBody -> 201 { data: World }
GET    /api/v1/worlds/:id       -> 200 { data: World }
PATCH  /api/v1/worlds/:id       updateWorldBody -> 200 { data: World }
DELETE /api/v1/worlds/:id       -> 204
```

### Health

```
GET    /health/live             -> 200 { status: 'ok' }
GET    /health/ready            -> 200 { status: 'ok' } | 503 { status: 'not_ready', dependencies: [...] }
GET    /health/status           -> 200 ServiceHealthReport (never 5xx)
```

### OpenAPI

```
GET    /openapi.json            -> 200 (OpenAPI 3.1 document)
```

**Zod schema excerpt:**

```typescript
// worlds.schema.ts
import { z } from 'zod/v4';

export const createWorldBody = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']).default('LOGICAL'),
});

export const worldResponse = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum([
    'IDLE',
    'CONFIGURING',
    'READY',
    'RUNNING',
    'PAUSED',
    'STOPPING',
    'STOPPED',
    'FAILED',
    'ARCHIVED',
  ]),
  runtimeMode: z.enum(['LOGICAL', 'CONTAINER', 'HYBRID']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
```

---

## 9. UI

### Login page (spec §7)

- Centered card, 480px max-width
- Email + password fields, "Sign in" button
- Error inline under the field that failed, not a generic banner
- On success: redirect to `/worlds`
- No "remember me" toggle (sessions expire server-side per config)

### App shell (spec §8–10, §12)

- Left sidebar (240px fixed): MIRRORGRID logo, nav links (Dashboard, Worlds, Events, Experiments,
  Reliability, Snapshots, Workers, Settings), user avatar + name at bottom
- Top bar: breadcrumbs, notification bell, user menu (profile, logout)
- System-status bar (§12): strip at top of content area showing overall health — HEALTHY (green),
  DEGRADED (amber), UNHEALTHY (red). Text label, never colour alone (spec §21 / accessibility).
- System status is server-component data from `/health/status`; re-fetched every 30s

### Dashboard (spec §13–14)

- Four stat cards: Total Worlds, Active Experiments, Events Today, System Health
- All numbers from real API rows — if zero, card says "0" not a skeleton that never loads
- Recent worlds list (last 5 modified) linking to `/worlds/:id`

### Worlds list (spec §15)

- Grid of World cards: name, description, status badge, runtime-mode chip, created date
- "New World" button top-right opens create-world modal
- Empty state: illustration + "Create your first world" CTA (spec §55)

### Create-world modal (spec §16)

- Name (required), description (optional), runtime-mode radio (LOGICAL default)
- Inline validation on submit; on success close modal and optimistically add card
- On error: display AppError message with requestId

### Design tokens (tokens.css)

```css
:root {
  --color-bg: #ffffff;
  --color-primary: #111111;
  --color-secondary: #6b7280;
  --color-border: #e5e7eb;
  --color-surface: #f8f9fa;

  /* Semantic */
  --color-success: #16a34a;
  --color-warning: #d97706;
  --color-error: #dc2626;
  --color-info: #2563eb;
  --color-neutral: #64748b;

  /* Spacing: 4-point scale */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;

  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --font-sans: 'Inter', system-ui, sans-serif;
}
```

Light mode is primary (spec §63). Dark topology/trace mode arrives at M8 with identical semantics.

---

## 10. Steps

Each step is independently committable. Prefix commits with `M00:`.

1. **Monorepo init** — `package.json` (workspaces), `turbo.json` (build/dev/lint/typecheck/test
   pipeline), root `tsconfig.base.json`, `eslint.config.js` (flat config, typescript-eslint, both
   tiers), `.prettierrc`, `.editorconfig`, `.gitignore`, `CLAUDE.md`, `.env.example`.

2. **packages/config** — env schema, safeParse, frozen export.

3. **packages/logging** — pino factory with required fields.

4. **packages/platform** — HealthProbe, CorrelationContext, AsyncLocalStorage propagation.

5. **packages/validation** — pagination, UUID schemas.

6. **packages/db** — Drizzle client, migrate runner, `001_core.sql`, drizzle.config.ts.

7. **docker-compose.yml** — full definition (all services, all profiles), `core` profile only active.
   Postgres healthcheck: `pg_isready -U $POSTGRES_USER`.

8. **apps/gateway** — Fastify factory, request-id plugin, error handler, health routes,
   `@fastify/swagger` at `/openapi.json`, forwarding to apps/control.

9. **apps/control — core** — AppError, response utils, pagination utils, auth middleware.

10. **apps/control — auth module** — all six files, Argon2id hashing, cookie set/clear,
    session lifecycle.

11. **apps/control — worlds module** — all six files, status CHECK validation, paginated list.

12. **Commit OpenAPI snapshot** — `npm run openapi:generate` writes `schemas/api/openapi.json`.

13. **apps/web — foundation** — Next.js 16 setup, design tokens, primitive UI components.

14. **apps/web — login page** — session cookie auth flow to `/worlds` redirect.

15. **apps/web — app shell** — sidebar, topbar, system-status bar using real `/health/status`.

16. **apps/web — dashboard** — real counts from real API.

17. **apps/web — worlds list + create modal** — real CRUD through generated types.

18. **GitHub Actions CI** — typecheck, lint, dependency-cruiser, unit, integration (testcontainers
    Postgres), contract (OpenAPI drift, no-mock-data grep), gitleaks.

19. **verify:m0 script** — orchestrates the gate assertions listed in §12.

---

## 11. Testing

### Unit

- `AppError` static factories return correct statusCode and code
- `HealthProbe`: readiness fails when a required dependency is UNHEALTHY; stays ready when degraded
- `config` safeParse: missing required vars exit; optional vars get defaults
- Session token generation produces 32-byte hex, no collisions in 10,000 draws
- `worlds.service.ts`: duplicate name -> conflict error; invalid status transition -> bad request

### Integration (testcontainers — real Postgres)

- `POST /auth/login` with correct creds -> 200 + cookie; wrong creds -> 401
- `POST /auth/logout` invalidates session (subsequent `/auth/me` -> 401)
- `GET /worlds` returns empty list for new org; created world appears
- Migration: apply to blank DB succeeds; re-run is idempotent

### Contract

- Served `/openapi.json` === committed `schemas/api/openapi.json` (byte-for-byte after stable sort)
- No file in the repo matches the glob `**/mock-data.ts`

### E2E (Playwright)

- Sign in -> create world "Metro-01" -> appears in list -> page reload persists it
- Stopping Postgres -> `/health/ready` returns 503; `/health/live` returns 200

---

## 12. Gate

```bash
npm run verify:m0
```

Assertions (in order):

1. `docker compose --profile core up -d` -> Postgres healthy in under 30 seconds
2. `npm run db:migrate` on clean DB succeeds; re-run is no-op (idempotent)
3. Playwright: sign in -> create World "Metro-01" -> appears in list -> reload persists it.
   **Asserted:** HTTP 201 with `{ data: { id, name: "Metro-01", status: "IDLE" } }`
4. `GET /health/live` returns 200 `{ status: "ok" }`
5. `GET /health/ready` returns 200 while Postgres is up; returns 503 after `docker stop postgres`
6. `GET /health/status` returns `ServiceHealthReport` shape (never 5xx)
7. Served `/openapi.json` matches `schemas/api/openapi.json` (contract drift fails)
8. No file in the repo matches `**/mock-data.ts`
9. CI workflow passes on a pushed commit (verified by GitHub Actions badge)

---

## 13. Pitfalls

- **Liveness wired to Postgres.** If `/health/live` fails when Postgres is down, all later
  §78 partial-failure behaviour is broken. Liveness must return 200 unless the process itself
  is broken.

- **JWT instead of sessions.** JWT cannot invalidate without a revocation store. If you reach
  for JWT because it is familiar, you will need a Redis revocation list, which makes Redis an
  M0 dependency and breaks the memory budget.

- **Floating-tag Postgres image.** `postgres:18` will drift between runs. Use `postgres:18.6`
  (pin the exact patch tag) so "same git commit" still means "same stack."

- **Mock data surviving the sprint.** The no-mock rule means zero `mock-data.ts` files, ever.
  If a screen is tempting to build with fixtures first, resist: build the endpoint first.

- **OpenAPI drift.** If `schemas/api/openapi.json` is not committed after each API change, the
  contract test fails on the next CI run. Add `npm run openapi:generate` to the pre-commit hook.

- **Cookies and CORS.** The frontend (`localhost:3000`) must send cookies to the gateway
  (`localhost:4000`). Requires `credentials: 'include'` on all fetches and matching
  `Access-Control-Allow-Origin: http://localhost:3000` (not `*`) in CORS config.

- **No-unused-locals set to false.** All sibling projects did this. In MIRRORGRID it is `true`
  from commit one. Hollow service shells compile only if this is false.

---

## 14. Done

- [ ] `npm run verify:m0` passes all 9 assertions on a clean clone
- [ ] `/health/live` stays 200 when Postgres is stopped
- [ ] Login, create world, reload: all backed by real DB rows
- [ ] No file in the repo matches `**/mock-data.ts`
- [ ] Served OpenAPI matches committed `schemas/api/openapi.json`
- [ ] CI workflow is green on a pushed commit
- [ ] `packages/sim` and `packages/reliability` directories exist with zero files (placeholders for M2/M4)
- [ ] Compose file defines all services; only the `core` profile starts
- [ ] `docs/adr/001-session-auth-not-jwt.md` written
- [ ] `docs/adr/002-compose-define-all-start-one.md` written
