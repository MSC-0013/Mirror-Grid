/**
 * M8 Verification Gate Script: tests/gates/verify-events.ts
 *
 * Enforces the M08 Event Platform verification assertions:
 * 1. Outbox transaction atomicity: zero event loss and zero dual-write corruption on rollback.
 * 2. Per-world causal ordering: strictly monotonic sequence numbering (1, 2, ..., N).
 * 3. Consumer idempotency: duplicate deliveries deduplicated cleanly with zero redundant processing.
 * 4. CQRS activity feed projection: accurately reflects domain events asynchronously.
 * 5. WebSocket gateway broadcast: real-time fanout to client with sub-50ms latency.
 * 6. Zero-Mock Rule compliance (§102).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { runMigrations, db, sql } from '../../packages/db/src/index.js';
import { outboxEvents, worldActivityFeed } from '../../packages/db/src/schema/events.js';
import { worlds, organizations, users } from '../../packages/db/src/schema/core.js';
import {
  OutboxWriter,
  OutboxRelay,
  EventBus,
  IdempotentConsumer,
  ActivityProjector,
} from '@mirrorgrid/events';
import { buildServer } from '../../apps/control/src/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

async function checkNoMockDataRule(dir: string): Promise<string[]> {
  const violations: string[] = [];

  function scan(currentDir: string) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === 'node_modules' ||
        entry.name === '.git' ||
        entry.name === '.next' ||
        entry.name === 'dist'
      ) {
        continue;
      }
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.name === 'mock-data.ts' || entry.name.endsWith('.mock.ts')) {
        violations.push(fullPath);
      }
    }
  }

  scan(dir);
  return violations;
}

async function runGate() {
  console.log('====================================================');
  console.log('       MIRRORGRID M8: Event Platform Gate           ');
  console.log('====================================================\n');

  // 1. Ensure migrations are applied
  console.log('[1/6] Applying database migrations for event platform...');
  await runMigrations();
  console.log('✓ SQLite database migrations up to date (including 009_events.sql).');

  // Ensure organization and user exist
  let org = (await db.select().from(organizations).limit(1))[0];
  if (!org) {
    const orgId = crypto.randomUUID();
    const [created] = await db
      .insert(organizations)
      .values({
        id: orgId,
        name: 'Event Test Org',
        slug: `event-test-org-${Date.now()}`,
      })
      .returning();
    org = created;
  }

  let user = (await db.select().from(users).limit(1))[0];
  if (!user) {
    const userId = crypto.randomUUID();
    const [created] = await db
      .insert(users)
      .values({
        id: userId,
        email: `event-test-${Date.now()}@mirrorgrid.local`,
        passwordHash: 'dummy-hash',
        displayName: 'Event Test User',
      })
      .returning();
    user = created;
  }

  // Create a dedicated test world
  const testWorldId = crypto.randomUUID();
  await db.insert(worlds).values({
    id: testWorldId,
    organizationId: org.id,
    createdBy: user.id,
    name: `Event-Platform-Test-World-${Date.now()}`,
    status: 'READY',
    runtimeMode: 'LOGICAL',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // =========================================================================
  // Assertion 1: Atomic Outbox Transaction & Zero Dual-Write Corruption
  // =========================================================================
  console.log('\n[2/6] [Assertion 1] Testing Outbox Transaction Dual-Write Rollback Atomicity...');

  const abortedEventId = crypto.randomUUID();
  try {
    await db.transaction(async (tx) => {
      // Record an event inside the transaction
      await OutboxWriter.recordEvent(tx, {
        worldId: testWorldId,
        aggregateType: 'SERVICE',
        aggregateId: 'service-orders',
        eventType: 'FAULT_INJECTED',
        payload: { faultType: 'LATENCY', delayMs: 500, attempt: abortedEventId },
      });

      // Intentionally throw to force transaction abort and rollback
      throw new Error('INTENTIONAL_TRANSACTION_ROLLBACK');
    });
  } catch (err: unknown) {
    assert.strictEqual(
      (err as Error).message,
      'INTENTIONAL_TRANSACTION_ROLLBACK',
      'Transaction must abort with expected error',
    );
  }

  // Assert 0 rows exist in outbox_events for this aborted attempt
  const abortedOutboxRows = await db
    .select()
    .from(outboxEvents)
    .where(sql`${outboxEvents.payload} LIKE ${`%${abortedEventId}%`}`);

  assert.strictEqual(
    abortedOutboxRows.length,
    0,
    'Aborted transaction must leave 0 records in outbox_events (Zero dual-write)',
  );

  // Now perform a successful transaction with 3 atomic events
  const committedEvents = await db.transaction(async (tx) => {
    const e1 = await OutboxWriter.recordEvent(tx, {
      worldId: testWorldId,
      aggregateType: 'EXPERIMENT',
      aggregateId: 'exp-flagship-1',
      eventType: 'EXPERIMENT_STARTED',
      payload: { experimentId: 'exp-flagship-1' },
    });
    const e2 = await OutboxWriter.recordEvent(tx, {
      worldId: testWorldId,
      aggregateType: 'FAULT',
      aggregateId: 'fault-timeout-1',
      eventType: 'FAULT_INJECTED',
      payload: { faultType: 'TIMEOUT', targetEdge: 'edge-payments' },
    });
    const e3 = await OutboxWriter.recordEvent(tx, {
      worldId: testWorldId,
      aggregateType: 'CIRCUIT_BREAKER',
      aggregateId: 'cb-edge-payments',
      eventType: 'CIRCUIT_TRIPPED',
      payload: { edgeId: 'edge-payments', state: 'OPEN', failureRatePpm: 750000 },
    });
    return [e1, e2, e3];
  });

  const committedRows = await db
    .select()
    .from(outboxEvents)
    .where(sql`${outboxEvents.worldId} = ${testWorldId}`);

  assert.strictEqual(
    committedRows.length,
    3,
    'Committed transaction must persist exactly 3 outbox rows',
  );
  console.log(
    '✓ Assertion 1 PASSED: Rollback produced 0 outbox events; Commit persisted 3 atomic events with 100% fidelity.',
  );

  // =========================================================================
  // Assertion 2: Per-World Monotonic Causal Sequence Ordering
  // =========================================================================
  console.log('\n[3/6] [Assertion 2] Testing Strictly Monotonic Causal Ordering per World...');

  assert.strictEqual(committedEvents[0].sequenceNum, 1, 'First event sequenceNum must be 1');
  assert.strictEqual(committedEvents[1].sequenceNum, 2, 'Second event sequenceNum must be 2');
  assert.strictEqual(committedEvents[2].sequenceNum, 3, 'Third event sequenceNum must be 3');

  // Enqueue 7 more events sequentially to verify gapless monotonically increasing sequence
  for (let i = 4; i <= 10; i++) {
    const ev = await OutboxWriter.recordEvent(db, {
      worldId: testWorldId,
      aggregateType: 'SERVICE',
      aggregateId: `service-${i}`,
      eventType: 'PHASE_CHANGED',
      payload: { phase: `PHASE_${i}` },
    });
    assert.strictEqual(
      ev.sequenceNum,
      i,
      `Sequence number must be strictly monotonic gapless ${i}`,
    );
  }

  console.log(
    '✓ Assertion 2 PASSED: Per-world sequence numbers strictly monotonic [1, 2, 3, ..., 10].',
  );

  // =========================================================================
  // Assertion 3: Consumer Idempotency & Deduplication
  // =========================================================================
  console.log('\n[4/6] [Assertion 3] Testing Idempotent Consumer Deduplication Ledger...');

  const duplicateEvent = committedEvents[0];
  const consumerGroup = 'test_gate_consumer_group';
  let handlerInvocations = 0;

  // First consumption: should execute handler
  const res1 = await IdempotentConsumer.consume(duplicateEvent, consumerGroup, async () => {
    handlerInvocations++;
  });
  assert.strictEqual(res1.processed, true, 'First consumption must be marked processed');
  assert.strictEqual(res1.duplicate, false, 'First consumption must not be marked duplicate');
  assert.strictEqual(handlerInvocations, 1, 'Handler must have been invoked once');

  // Second consumption of identical event: should be detected as duplicate and skipped
  const res2 = await IdempotentConsumer.consume(duplicateEvent, consumerGroup, async () => {
    handlerInvocations++;
  });
  assert.strictEqual(res2.processed, false, 'Duplicate consumption must not be marked processed');
  assert.strictEqual(res2.duplicate, true, 'Duplicate consumption must be flagged duplicate');
  assert.strictEqual(
    handlerInvocations,
    1,
    'Handler must NOT be invoked again on duplicate delivery',
  );

  console.log(
    '✓ Assertion 3 PASSED: Duplicate event delivery safely detected and skipped without redundant processing.',
  );

  // =========================================================================
  // Assertion 4: CQRS Denormalized Activity Feed Projection
  // =========================================================================
  console.log('\n[5/6] [Assertion 4] Testing CQRS Activity Feed Read Model Projection...');

  const projector = new ActivityProjector();
  projector.start();

  // Run the Outbox Relay to process unpublished events
  const relay = new OutboxRelay({ batchSize: 100 });
  const publishedBatchCount = await relay.processBatch();
  assert.ok(
    publishedBatchCount >= 10,
    `Relay must publish at least all 10 pending events, got ${publishedBatchCount}`,
  );

  // Small tick to allow async projection execution
  await new Promise((r) => setTimeout(r, 100));

  // Query projected world_activity_feed table
  const feedItems = await db
    .select()
    .from(worldActivityFeed)
    .where(sql`${worldActivityFeed.worldId} = ${testWorldId}`);

  assert.ok(feedItems.length > 0, 'World activity feed must contain projected items');

  const criticalTripItem = feedItems.find((item) => item.eventType === 'CIRCUIT_TRIPPED');
  assert.ok(criticalTripItem, 'CIRCUIT_TRIPPED event must be projected into activity feed');
  assert.strictEqual(
    criticalTripItem.severity,
    'CRITICAL',
    'CIRCUIT_TRIPPED must have CRITICAL severity',
  );
  assert.ok(
    criticalTripItem.summary.includes('Circuit breaker'),
    'Activity feed summary must format breaker trip clearly',
  );

  // Test rebuilding projection from scratch
  const rebuildRes = await projector.rebuildProjection(testWorldId);
  assert.strictEqual(
    rebuildRes.replayedCount,
    10,
    `Rebuilding projection must replay all 10 events, got ${rebuildRes.replayedCount}`,
  );

  projector.stop();
  console.log(
    `✓ Assertion 4 PASSED: CQRS activity feed projected ${feedItems.length} items with accurate severity and full rebuild replay.`,
  );

  // =========================================================================
  // Assertion 5: Real-Time WebSocket Gateway Broadcast (< 50ms Latency)
  // =========================================================================
  console.log('\n[6/6] [Assertion 5] Testing Real-Time WebSocket Multiplexing & Latency Bound...');

  const app = buildServer();
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const serverAddress = app.server.address() as AddressInfo;
  const wsPort = serverAddress.port;

  const wsUrl = `ws://127.0.0.1:${wsPort}/api/v1/ws`;
  const wsClient = new WebSocket(wsUrl);

  const receivedQueue: { msg: Record<string, unknown>; time: number }[] = [];
  const waiters: Array<() => void> = [];

  wsClient.on('message', (data: Buffer | string) => {
    const raw = typeof data === 'string' ? data : data.toString('utf8');
    try {
      const msg = JSON.parse(raw) as Record<string, unknown>;
      receivedQueue.push({ msg, time: Date.now() });
      for (const w of waiters) w();
    } catch {
      // ignore malformed
    }
  });

  async function waitForWsMessage(
    predicate: (msg: Record<string, unknown>) => boolean,
    timeoutMs = 5000,
  ): Promise<{ msg: Record<string, unknown>; time: number }> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const idx = receivedQueue.findIndex((item) => predicate(item.msg));
      if (idx !== -1) {
        return receivedQueue.splice(idx, 1)[0];
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 30);
        waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    throw new Error(`Timeout waiting for WebSocket message after ${timeoutMs}ms`);
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WebSocket connection timeout')), 3000);
    wsClient.on('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    wsClient.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  // Subscribe to world events
  const targetTopic = `world:${testWorldId}:events`;
  wsClient.send(JSON.stringify({ action: 'subscribe', topic: targetTopic }));

  // Wait for subscription confirmation
  await waitForWsMessage(
    (msg) => msg.type === 'subscribed' && msg.topic === targetTopic,
    3000,
  );

  // Now measure broadcast latency
  const sendTime = Date.now();
  const testEvent = {
    id: crypto.randomUUID(),
    worldId: testWorldId,
    aggregateType: 'SERVICE',
    aggregateId: 'service-checkout',
    eventType: 'CIRCUIT_TRIPPED',
    partitionKey: testWorldId,
    sequenceNum: 11,
    payload: { edgeId: 'edge-checkout', state: 'OPEN', failureRatePpm: 900000 },
    headers: { correlationId: crypto.randomUUID() },
    timestamp: new Date(),
  };

  // Publish event to EventBus
  await EventBus.getInstance().publish(targetTopic, testEvent);

  const received = await waitForWsMessage(
    (msg) => msg.type === 'event' && msg.topic === targetTopic,
    3000,
  );

  const latencyMs = received.time - sendTime;
  assert.ok(received.msg !== null, 'WebSocket client must receive broadcasted event');
  assert.strictEqual(
    received.msg.data.id,
    testEvent.id,
    'Broadcast event ID must match sent event',
  );
  assert.ok(
    latencyMs < 50,
    `WebSocket broadcast latency must be sub-50ms (measured: ${latencyMs}ms)`,
  );

  wsClient.close();
  await app.close();
  console.log(
    `✓ Assertion 5 PASSED: WebSocket broadcast delivered event to client in ${latencyMs}ms (< 50ms bound).`,
  );

  // =========================================================================
  // Zero-Mock Rule Compliance Check
  // =========================================================================
  console.log('\nChecking Zero-Mock Rule (§102) across events package...');
  const violations = await checkNoMockDataRule(path.join(REPO_ROOT, 'packages', 'events'));
  assert.strictEqual(
    violations.length,
    0,
    `Zero-mock rule violation: found forbidden mock files: ${violations.join(', ')}`,
  );
  console.log('✓ Zero-Mock Rule (§102) verified: 0 mock data files found.');

  // Cleanup test world
  await db.delete(worlds).where(sql`${worlds.id} = ${testWorldId}`);

  console.log('\n====================================================');
  console.log('     ALL 5 GATE ASSERTIONS PASSED GREEN (M08)       ');
  console.log('====================================================\n');
}

runGate().catch((err) => {
  console.error('\n❌ Gate verification failed:', err);
  process.exit(1);
});
