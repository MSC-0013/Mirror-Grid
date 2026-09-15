# M08 — Event Platform: Outbox, Kafka, and CQRS

## 1. Context

As a distributed-systems laboratory, MIRRORGRID generates a torrential stream of domain events:
simulation ticks, circuit breaker trips, fault injections, anomaly detections, and worker state changes.
In earlier milestones (M00–M07), the UI relied on polling HTTP endpoints every 1–2 seconds.
In an incident simulation, a 2-second polling lag is unacceptable: an operator cannot observe a
half-open circuit trial or a microsecond deadline cascade if the UI only refreshes every few seconds.

Furthermore, distributed architectures must never rely on direct, synchronous HTTP calls between internal
subsystems for cross-cutting notifications. Doing so creates tight temporal coupling, distributed transactions,
and catastrophic cascading failures.

This milestone establishes MIRRORGRID’s enterprise Event Platform:
1. **The Transactional Outbox Pattern:** Guarantees zero event loss and eliminates the dual-write bug.
   Events are written to PostgreSQL inside the same atomic transaction as the domain state changes.
2. **Apache Kafka Streaming:** Production-grade event bus powered by `@confluentinc/kafka-javascript`
   (conforming to project standards; `kafkajs` is strictly prohibited).
3. **Per-World Partition Ordering:** Partition keys bound to `world_id` guarantee strict linear causal
   ordering within each world while allowing unlimited horizontal scalability across worlds.
4. **CQRS Read Projections:** Asynchronous projections denormalize event streams into read-optimized views.
5. **Real-Time WebSocket Gateway:** `apps/gateway` multiplexes Kafka events over persistent WebSockets
   to the Next.js frontend with sub-50ms latency.

---

## 2. Prerequisites

- M05 green (`verify:flagship` — Tier 1 core completed)
- M06 green (`verify:m6` — security and RBAC)
- M07 green (`verify:concurrency` — async jobs platform)
- Docker Compose profile: `--profile full` (Postgres, Redis, Kafka, Zookeeper/KRaft)

---

## 3. Scope

### In scope
- PostgreSQL Transactional Outbox (`outbox_events` table).
- Outbox Relay daemon polling/streaming unpublished events to Apache Kafka with `acks: 'all'`.
- Apache Kafka integration using `@confluentinc/kafka-javascript` with TLS and SASL support.
- Causal event sequencing: strictly monotonic per-world sequence numbers (`sequence_num`).
- Idempotent consumer framework with deduplication tracking (`consumed_events` table).
- CQRS read projections: `world_activity_feed` and live experiment aggregations.
- WebSocket server in `apps/gateway` with subscription multiplexing, topic filters, and heartbeat ping/pong.
- Database migration `009_events.sql`: `outbox_events`, `consumed_events`, and `world_activity_feed`.
- UI: Real-time WebSocket connection HUD, animated live activity ticker, and polling elimination.

### Explicitly out of scope
- Kafka Schema Registry integration with Avro/Protobuf (standardized JSON with schema versioning used at M08).
- Multi-datacenter Kafka MirrorMaker / active-active geo-replication.
- Complex Event Processing (CEP) with Apache Flink.

---

## 4. Design

### The Dual-Write Problem and the Transactional Outbox

When a service modifies database state and publishes an event, attempting to do both directly is flawed:
```
// THE BUGGY DUAL-WRITE PATTERN:
await db.update(breakers).set({ state: 'OPEN' }); // Succeeds
await kafkaProducer.send({ topic: 'events', ... }); // Broker unavailable! Event lost forever.
```
If the broker is down, the event is never published, and downstream read models and WebSockets desynchronize.
If the order is reversed (publish then DB write), a DB deadlock causes an event to fire for a transaction
that was aborted and rolled back.

**The Transactional Outbox Solution:**
```typescript
// THE ATOMIC OUTBOX PATTERN:
await db.transaction(async (tx) => {
  await tx.update(circuitBreakerStates).set({ currentState: 'OPEN' });
  await outboxService.recordEvent(tx, {
    aggregateType: 'CIRCUIT_BREAKER',
    aggregateId: edgeId,
    eventType: 'CIRCUIT_TRIPPED',
    partitionKey: worldId,
    payload: { edgeId, state: 'OPEN', failureRatePpm: 650000 },
  });
});
```
The domain update and the event are committed in a single atomic database write.
An asynchronous **Outbox Relay** reads unpublished rows using `FOR UPDATE SKIP LOCKED`, sends them to
Kafka, and marks them `published_at = NOW()`.

### Per-World Causal Ordering

In distributed systems, preserving the causal order of events is critical: a `CIRCUIT_TRIPPED` event
must never be consumed before the `FAULT_INJECTED` event that triggered it.

MIRRORGRID guarantees causal order by binding the Kafka partition key to `world_id`:
$$\text{partition} = \text{hash}(\text{world\_id}) \pmod{\text{num\_partitions}}$$
- All events for World A are routed to the same Kafka partition and processed in order by a single consumer.
- Events for World B and World C are routed to different partitions and processed concurrently.
- Each event carries a monotonic `sequence_num` scoped to `world_id`. If a consumer receives sequence #12
  when expecting #11, it halts and flags an out-of-order anomaly.

### Idempotent Consumer Pattern

Because network failures between the Outbox Relay and Kafka can cause duplicate deliveries (at-least-once
delivery guarantee), consumers must be strictly idempotent:

```sql
INSERT INTO consumed_events (event_id, consumer_group, processed_at)
VALUES ($1, $2, NOW())
ON CONFLICT (event_id, consumer_group) DO NOTHING
RETURNING event_id;
```
If the insert returns 0 rows, the event has already been processed by this consumer group and is safely skipped.

### Real-Time WebSocket Multiplexing (`apps/gateway`)

Frontend clients establish a single persistent WebSocket connection to the API Gateway:
`ws://localhost:3000/api/v1/ws`.

Clients send subscription commands:
```json
{ "action": "subscribe", "topic": "world:a1b2c3d4:metrics" }
```
The Gateway maintains a connection registry. When a metric or status event arrives from Kafka (or the local
Redis Pub/Sub bridge), the Gateway filters and broadcasts the payload to all subscribed clients in < 20ms.

---

## 5. Data Model

Full DDL for migration `packages/db/src/migrations/009_events.sql`:

```sql
-- 009_events.sql: Transactional Outbox, idempotent consumer tracking, and CQRS activity feed

-- 1. Transactional Outbox table
CREATE TABLE outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    aggregate_type VARCHAR(50) NOT NULL, -- 'WORLD', 'SERVICE', 'CIRCUIT_BREAKER', 'EXPERIMENT', 'FAULT'
    aggregate_id VARCHAR(120) NOT NULL,
    event_type VARCHAR(100) NOT NULL,    -- e.g. 'CIRCUIT_TRIPPED', 'FAULT_INJECTED', 'PHASE_CHANGED'
    partition_key VARCHAR(120) NOT NULL, -- Bound to world_id for causal ordering
    sequence_num BIGINT NOT NULL,        -- Monotonic sequence number per world
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    headers JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ             -- NULL until acknowledged by Kafka broker
);

CREATE INDEX idx_outbox_unprocessed ON outbox_events(created_at ASC)
    WHERE published_at IS NULL;
CREATE INDEX idx_outbox_world_seq ON outbox_events(world_id, sequence_num ASC);

-- 2. Idempotent Consumer deduplication ledger
CREATE TABLE consumed_events (
    event_id UUID NOT NULL,
    consumer_group VARCHAR(80) NOT NULL,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, consumer_group)
);

CREATE INDEX idx_consumed_events_date ON consumed_events(processed_at);

-- 3. CQRS World Activity Feed (Denormalized read projection)
CREATE TABLE world_activity_feed (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    world_id UUID NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
    event_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL,
    actor_email VARCHAR(255),
    severity VARCHAR(20) NOT NULL DEFAULT 'INFO', -- INFO, WARNING, CRITICAL
    summary TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_feed_world ON world_activity_feed(world_id, occurred_at DESC);
```

### Index rationale
- `idx_outbox_unprocessed`: Partial index targeting only unpublished events. Keeps outbox relay polling
  lightning-fast even when millions of historical events exist.
- `idx_outbox_world_seq`: Enforces fast ordered retrieval of event logs for timeline replay and audit.

---

## 6. Packages

```
packages/events/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     # Public exports
│   ├── schemas/
│   │   ├── event-envelope.ts        # Standardized event envelope definition
│   │   └── domain-events.ts         # Zod schemas for all domain events
│   ├── outbox/
│   │   ├── outbox-writer.ts         # Transactional outbox writer
│   │   ├── outbox-relay.ts          # Background relay polling outbox to Kafka
│   │   └── sequence-allocator.ts    # Monotonic per-world sequence manager
│   ├── kafka/
│   │   ├── producer.ts              # Confluent Kafka producer with acks=all
│   │   ├── consumer-group.ts        # Partition-aware consumer group worker
│   │   └── config.ts                # Broker connection and TLS configuration
│   ├── cqrs/
│   │   ├── projection-manager.ts    # Event dispatcher to read projectors
│   │   └── activity-projector.ts    # Updates world_activity_feed projection
│   └── ws/
│       ├── ws-protocol.ts           # Subscription message formats
│       └── topic-matcher.ts         # Topic wildcard matching logic
packages/db/
├── src/
│   ├── schema/
│   │   └── events.ts                # Drizzle schema matching 009_events.sql
│   └── migrations/
│       └── 009_events.sql           # Migration DDL above
apps/gateway/
├── src/
│   └── ws/
│       ├── ws-server.ts             # Fastify WebSocket route handler
│       ├── connection-registry.ts   # Active client socket connection manager
│       └── event-broadcaster.ts     # Fanout bridge from Kafka/Redis to WebSockets
apps/web/
├── src/
│   ├── hooks/
│   │   └── use-websocket.ts         # React hook for auto-reconnecting WebSocket
│   └── components/
│       └── activity-feed/
│           ├── live-feed-ticker.tsx # Real-time animated event feed (§68)
│           └── connection-hud.tsx   # Live connection status badge
```

---

## 7. Interfaces

### Standardized Event Envelope

```typescript
// packages/events/src/schemas/event-envelope.ts

export interface EventHeaders {
  readonly correlationId: string;
  readonly causationId?: string;
  readonly actorId?: string;
  readonly actorEmail?: string;
}

export interface DomainEventEnvelope<T = unknown> {
  readonly id: string;
  readonly worldId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly partitionKey: string;
  readonly sequenceNum: bigint;
  readonly payload: T;
  readonly headers: EventHeaders;
  readonly timestamp: Date;
}
```

### Outbox and Producer Contracts

```typescript
// packages/events/src/outbox/outbox-writer.ts

export interface OutboxWriteInput<T = unknown> {
  readonly worldId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly payload: T;
  readonly headers?: Partial<EventHeaders>;
}

export interface OutboxWriter {
  recordEvent<T>(tx: unknown, input: OutboxWriteInput<T>): Promise<DomainEventEnvelope<T>>;
}

export interface EventProducer {
  publish(event: DomainEventEnvelope): Promise<{ readonly partition: number; readonly offset: bigint }>;
  publishBatch(events: readonly DomainEventEnvelope[]): Promise<void>;
}
```

### WebSocket Protocol Types

```typescript
// packages/events/src/ws/ws-protocol.ts

export type ClientMessage =
  | { readonly action: 'subscribe'; readonly topic: string }
  | { readonly action: 'unsubscribe'; readonly topic: string }
  | { readonly action: 'ping' };

export type ServerMessage =
  | { readonly type: 'subscribed'; readonly topic: string }
  | { readonly type: 'event'; readonly topic: string; readonly data: unknown }
  | { readonly type: 'pong' }
  | { readonly type: 'error'; readonly code: string; readonly message: string };
```

---

## 8. API

### 1. WebSocket Stream Gateway
- **Endpoint:** `GET /api/v1/ws` (WebSocket upgrade)
- **Protocol:** JSON messages conforming to `ClientMessage` / `ServerMessage`.
- **Supported Topic Patterns:**
  - `world:<worldId>:metrics` — Live 1-second metric samples.
  - `world:<worldId>:events` — Domain state changes, breaker transitions, and faults.
  - `world:<worldId>:activity` — Formatted activity feed items.

### 2. Query World Activity Feed (REST fallback)
- `GET /api/v1/worlds/:worldId/activity-feed`
- **Query Params:** `limit=50&before=timestamp`
- **Response:** `200 OK` with `{ data: ActivityFeedItem[], nextCursor: string }`.

### 3. Outbox Relay Health & Status
- `GET /api/v1/admin/outbox/status`
- **Response:** `200 OK` with `{ pendingCount: number, oldestPendingAgeMs: number, relayLagMs: number }`.

---

## 9. UI

### 1. Live Activity Feed Ticker (`apps/web/src/components/activity-feed/live-feed-ticker.tsx`)
- **Spec alignment:** §68 (Real-Time Activity Stream & Event Ticker).
- **Layout:**
  - Placed on World Overview and Live Experiment screens.
  - Animated item entry using CSS micro-transitions (subtle fade-in and slide-down).
  - Item Badges:
    - `CRITICAL` (Red pulse): Emergency abort, circuit breaker trip, detector anomaly.
    - `WARNING` (Amber): High queue saturation, retry rate spike.
    - `INFO` (Blue): World created, experiment started, normal config update.
  - Timestamp display formatted as relative ("2s ago") with absolute tooltip on hover.

### 2. Real-Time Connection HUD (`apps/web/src/components/activity-feed/connection-hud.tsx`)
- **Visuals:** Top-right navbar badge showing live WebSocket health:
  - Green pulsing dot: `CONNECTED (sub-10ms)`
  - Amber spinning icon: `RECONNECTING (attempt 2/5)`
  - Grey dot: `OFFLINE (HTTP Fallback active)`

---

## 10. Steps

1. **Create `packages/events` package:** Scaffold package, dependencies (`@confluentinc/kafka-javascript`, `zod`), and tsconfig.
2. **Define domain event envelopes:** Implement strict Zod schemas for all domain event payloads.
3. **Implement Transactional Outbox Writer:** Write `src/outbox/outbox-writer.ts` integrating with Drizzle transactions.
4. **Implement Monotonic Sequence Allocator:** Ensure gapless sequence numbers per world.
5. **Implement Apache Kafka Producer:** Write producer using `@confluentinc/kafka-javascript` with `acks: 'all'`.
6. **Build Outbox Relay Daemon:** Implement polling loop with `FOR UPDATE SKIP LOCKED` and batch publishing.
7. **Implement Idempotent Consumer Group:** Build consumer with `consumed_events` deduplication tracking.
8. **Build CQRS Activity Projector:** Create projection consumer updating `world_activity_feed`.
9. **Build WebSocket Gateway in `apps/gateway`:** Implement Fastify WebSocket handler with subscription registry.
10. **Build React WebSocket Client Hook:** Implement `useWebSocket` hook in `apps/web` with auto-reconnection.
11. **Build UI Live Activity Ticker & HUD:** Build real-time UI components and remove polling from dashboard.
12. **Implement `npm run verify:events` gate script:** Automated verification suite asserting all 5 event guarantees.

---

## 11. Testing

### Unit tests (`packages/events/tests/unit`)
- `envelope.test.ts`: Verify event serialization, timestamp parsing, and header propagation.
- `topic-matcher.test.ts`: Verify wildcard topic subscription matching (e.g. `world:*:metrics`).
- `dedup.test.ts`: Assert duplicate event IDs are rejected by the consumer idempotency guard.

### Integration tests (`packages/events/tests/integration`)
- `outbox-relay.test.ts`:
  - Enqueue 100 outbox events in a transaction; start Outbox Relay.
  - Assert all 100 events are published to Kafka and marked `published_at` in Postgres.
- `transaction-abort.test.ts`:
  - Begin transaction, record outbox event, rollback transaction.
  - Assert 0 events are written to outbox table and 0 events reach Kafka.
- `websocket-fanout.test.ts`:
  - Connect 5 mock WebSocket clients subscribed to `world:123:events`.
  - Emit event to Kafka; assert all 5 clients receive message in < 50ms.

---

## 12. Gate

Command: `npm run verify:events`

The gate test validates these 5 core event platform assertions:

```typescript
// tests/gates/verify-events.ts

// Assertion 1: Outbox transaction guarantees zero event loss and zero dual-write corruption
assert(outboxEventsPublishedCleanly, 'Assertion 1: Outbox events published to Kafka with 100% fidelity');

// Assertion 2: Per-world partition key guarantees strict causal sequence ordering
assert(causalSequenceMaintained, 'Assertion 2: Events consumed in exact monotonic sequence per world');

// Assertion 3: Consumer idempotency strictly drops duplicate message deliveries
assert(duplicateDropped && consumerStateCorrect, 'Assertion 3: Duplicate deliveries deduplicated cleanly');

// Assertion 4: CQRS activity feed projection accurately reflects domain events
assert(activityFeedUpdatedFromEvent, 'Assertion 4: CQRS activity feed updated asynchronously');

// Assertion 5: WebSocket gateway broadcasts event to client with sub-50ms latency
assert(wsDeliveryLatencyMs < 50, 'Assertion 5: Real-time WebSocket latency verified under 50ms');
```

---

## 13. Pitfalls

1. **Using `kafkajs` instead of `@confluentinc/kafka-javascript`:** Violates repository conventions.
   Always use `@confluentinc/kafka-javascript` (librdkafka-backed) for stability and performance.
2. **Omitting `partitionKey` on Kafka messages:** Default round-robin partitioning scrambles the causal
   ordering of events for a world. Always partition by `world_id`.
3. **Unbounded `outbox_events` table growth:** As millions of events are published, the table grows.
   Implement a nightly purge job deleting events where `published_at < NOW() - INTERVAL '7 days'`.
4. **WebSocket memory leaks on unclosed sockets:** If clients disconnect without proper socket cleanup,
   subscription registries leak memory. Attach ping/pong heartbeat timeouts to terminate zombie sockets.

---

## 14. Done

- [ ] `packages/events` compiles under strict TypeScript with 0 errors.
- [ ] Transactional outbox writer records events atomically with domain transactions.
- [ ] Outbox Relay reliably streams events to Kafka with `acks: 'all'`.
- [ ] Per-world causal ordering preserved via `world_id` partition keys.
- [ ] Idempotent consumer framework eliminates duplicate processing.
- [ ] Fastify WebSocket gateway streams events to web client with sub-50ms latency.
- [ ] Migration `009_events.sql` applied cleanly in Postgres.
- [ ] Polling removed from frontend in favor of real-time WebSocket hooks.
- [ ] `npm run verify:events` runs green in CI with all 5 gate assertions passing.
