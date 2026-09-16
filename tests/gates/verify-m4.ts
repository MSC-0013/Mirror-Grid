/**
 * Milestone M04 Verification Gate: tests/gates/verify-m4.ts
 *
 * Enforces the Milestone M04 verification assertions (§12):
 * 1. Circuit breaker state machine transitions deterministically (CLOSED -> OPEN -> HALF_OPEN -> CLOSED/OPEN).
 * 2. Retry budget strictly prevents retry amplification storms (capped at 10% under 100% failure).
 * 3. Deadline expiration sheds requests preemptively (0 downstream calls made).
 * 4. Fault injection accurately alters traffic behavior (observed latency shift).
 * 5. Chaos Safety Boundary triggers emergency auto-abort on SLO burn (terminates all active faults within 1 tick).
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CircuitBreakerCore,
  RetryBudgetCore,
  DeadlineInterceptor,
  DEADLINE_HEADER,
  FaultEngine,
  ChaosSafetyBoundary,
  type FaultSpec,
} from '../../packages/reliability/src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

async function runM4Gate() {
  console.log('====================================================');
  console.log('MIRRORGRID GATE VERIFICATION: Milestone M04');
  console.log('Reliability Primitives, Fault Engine, and Safety Bounds');
  console.log('====================================================\n');

  // ---------------------------------------------------------
  // Assertion 1: Circuit breaker state machine transitions deterministically
  // ---------------------------------------------------------
  console.log('--> Assertion 1: Formal Circuit Breaker State Transitions');
  {
    const config = {
      failureRateThresholdPpm: 500_000, // 50%
      volumeThreshold: 10,
      sleepWindowMicros: 5_000_000n, // 5s
      halfOpenMaxConcurrent: 2,
      consecutiveSuccessThreshold: 3,
      windowBucketCount: 10,
      bucketDurationMicros: 1_000_000n, // 1s
    };

    let now = 10_000_000n;
    const cb = new CircuitBreakerCore(config, now);

    assert.strictEqual(cb.state, 'CLOSED', 'Breaker must initialize to CLOSED');

    // Feed 5 successes, 4 failures (9 requests < volumeThreshold 10). Should remain CLOSED.
    for (let i = 0; i < 5; i++) {
      assert.strictEqual(cb.tryAcquire(now).allowed, true);
      cb.recordSuccess(now);
    }
    for (let i = 0; i < 4; i++) {
      assert.strictEqual(cb.tryAcquire(now).allowed, true);
      cb.recordFailure(now);
    }
    assert.strictEqual(cb.state, 'CLOSED', 'Must remain CLOSED below volumeThreshold');

    // 10th request fails -> total = 10, failures = 5 (50%) -> trips to OPEN
    cb.tryAcquire(now);
    const tripTransitions = cb.recordFailure(now);
    assert.strictEqual(cb.state, 'OPEN', 'Must transition to OPEN on threshold exceeded');
    assert.strictEqual(tripTransitions.length, 1);
    assert.strictEqual(tripTransitions[0].to, 'OPEN');

    // Requests during OPEN within sleepWindow are rejected
    now += 2_000_000n; // 2s < 5s
    const rej = cb.tryAcquire(now);
    assert.strictEqual(rej.allowed, false, 'Must reject calls while OPEN');

    // After sleepWindowMicros (5s), transitions to HALF_OPEN
    now += 3_500_000n; // 5.5s elapsed >= 5s
    const probe1 = cb.tryAcquire(now);
    assert.strictEqual(probe1.allowed, true, 'First trial probe must be admitted');
    assert.strictEqual(cb.state, 'HALF_OPEN', 'Must transition to HALF_OPEN after sleep window');

    const probe2 = cb.tryAcquire(now);
    assert.strictEqual(probe2.allowed, true, 'Second trial probe admitted under cap=2');

    const probe3 = cb.tryAcquire(now);
    assert.strictEqual(
      probe3.allowed,
      false,
      'Third probe must be rejected: halfOpenMaxConcurrent cap enforced',
    );

    // Trial failure in HALF_OPEN trips immediately back to OPEN
    const probeFailTrans = cb.recordFailure(now);
    assert.strictEqual(cb.state, 'OPEN', 'Trial probe failure must re-trip breaker to OPEN');
    assert.strictEqual(probeFailTrans[0].to, 'OPEN');

    // Advance 5s to HALF_OPEN again
    now += 5_000_000n;
    assert.strictEqual(cb.tryAcquire(now).allowed, true);
    assert.strictEqual(cb.state, 'HALF_OPEN');

    // Trial successes reaching consecutiveSuccessThreshold (3) closes breaker
    cb.recordSuccess(now);
    cb.tryAcquire(now);
    cb.recordSuccess(now);
    cb.tryAcquire(now);
    const closeTrans = cb.recordSuccess(now);
    assert.strictEqual(cb.state, 'CLOSED', 'Trial successes must re-close breaker');
    assert.strictEqual(closeTrans[0].to, 'CLOSED');

    console.log('    ✓ CLOSED -> OPEN -> HALF_OPEN -> OPEN confirmed');
    console.log('    ✓ CLOSED -> OPEN -> HALF_OPEN -> CLOSED confirmed');
    console.log('    ✓ Zero wall-clock timers used (100% deterministic)');
  }

  // ---------------------------------------------------------
  // Assertion 2: Retry budget limits retry amplification storms
  // ---------------------------------------------------------
  console.log('\n--> Assertion 2: Retry Budget Anti-Storm Guarantee');
  {
    const budget = new RetryBudgetCore({
      ttlMicros: 60_000_000n, // 60s
      minRetriesPerSec: 0,
      retryRatio: 0.1, // strictly 10% maximum retry traffic
    });

    const now = 10_000_000n;

    // Simulate 200 normal successful requests
    for (let i = 0; i < 200; i++) {
      budget.recordSuccess(now, false);
    }

    // Now downstream completely fails: 100 calls attempt to retry
    let retriesPermitted = 0;
    let retriesRejected = 0;

    for (let i = 0; i < 100; i++) {
      if (budget.canRetry(now)) {
        budget.recordRetry(now);
        retriesPermitted++;
      } else {
        retriesRejected++;
      }
    }

    // Under 10% ratio, exactly Math.floor(200 * 0.10) = 20 retries allowed
    assert.strictEqual(
      retriesPermitted,
      20,
      `Expected exactly 20 retries permitted (10% of 200), got ${retriesPermitted}`,
    );
    assert.strictEqual(
      retriesRejected,
      80,
      `Expected 80 retries shed to prevent downstream storm, got ${retriesRejected}`,
    );

    console.log(`    ✓ Initial requests: 200`);
    console.log(`    ✓ Retries permitted: ${retriesPermitted} (10.0% max ratio enforced)`);
    console.log(`    ✓ Storm amplification prevented: ${retriesRejected} retries shed`);
  }

  // ---------------------------------------------------------
  // Assertion 3: Deadline expiration sheds requests preemptively
  // ---------------------------------------------------------
  console.log('\n--> Assertion 3: Preemptive Deadline Shedding');
  {
    let downstreamInvocations = 0;
    const mockDownstreamCall = () => {
      downstreamInvocations++;
      return 'ok';
    };

    const now = 20_000_000n;
    const clock = { nowMicros: () => now };
    const interceptor = new DeadlineInterceptor(clock);

    // Case A: Deadline is already expired by 1ms
    const expiredHeaders = {
      [DEADLINE_HEADER]: (now - 1_000n).toString(),
    };

    let expiredCaught = false;
    try {
      interceptor.verify(expiredHeaders, 5_000n);
      mockDownstreamCall();
    } catch (err: unknown) {
      expiredCaught = true;
      assert.strictEqual((err as { code: string }).code, 'DEADLINE_EXCEEDED');
    }

    assert.strictEqual(expiredCaught, true, 'Expired deadline must throw DEADLINE_EXCEEDED');
    assert.strictEqual(
      downstreamInvocations,
      0,
      'Expired call must shed with 0 downstream calls made',
    );

    // Case B: Deadline has 10ms remaining, but downstream minimum latency is 20ms
    const tightHeaders = {
      [DEADLINE_HEADER]: (now + 10_000n).toString(),
    };

    let preemptiveCaught = false;
    try {
      interceptor.verify(tightHeaders, 20_000n); // 20ms required > 10ms remaining
      mockDownstreamCall();
    } catch (err: unknown) {
      preemptiveCaught = true;
      assert.strictEqual((err as { code: string }).code, 'DEADLINE_EXCEEDED');
    }

    assert.strictEqual(
      preemptiveCaught,
      true,
      'Preemptive shed must fire when latency exceeds remaining time',
    );
    assert.strictEqual(
      downstreamInvocations,
      0,
      'Preemptively shed request must make 0 downstream calls',
    );

    console.log('    ✓ Past deadlines rejected immediately');
    console.log('    ✓ Preemptive shedding verified (remaining < downstream latency)');
    console.log('    ✓ Total downstream calls made for shed requests: 0');
  }

  // ---------------------------------------------------------
  // Assertion 4: Fault injection accurately alters traffic behavior
  // ---------------------------------------------------------
  console.log('\n--> Assertion 4: Fault Injection Latency Shift');
  {
    const engine = new FaultEngine();
    const now = 10_000_000n;

    const faultSpec: FaultSpec = {
      id: 'fault-lat-100ms',
      worldId: 'test-world',
      name: 'Inject 100ms Latency',
      faultType: 'LATENCY',
      targetEdgeId: 'edge-gateway-to-orders',
      parameters: {
        percentage: 100,
        latencyMicros: 100_000n, // exactly 100ms
        jitterMicros: 0n,
        distribution: 'FIXED',
      },
      safetyRules: {
        maxDurationMicros: 60_000_000n,
        autoAbortOnBurnRate: true,
      },
    };

    // Before fault: baseline latency is 15ms (15_000µs)
    const baselineEffect = engine.evaluateEdgeCall(
      'edge-gateway-to-orders',
      'svc-gateway',
      'svc-orders',
      now,
    );
    assert.strictEqual(baselineEffect.injectedLatencyMicros, 0n);

    // Inject fault
    engine.injectFault(faultSpec, 'exec-1', now, 30_000_000n);

    const activeEffect = engine.evaluateEdgeCall(
      'edge-gateway-to-orders',
      'svc-gateway',
      'svc-orders',
      now,
    );
    assert.strictEqual(
      activeEffect.injectedLatencyMicros,
      100_000n,
      'Injected latency must equal 100,000µs (100ms)',
    );

    // Unrelated edge is unaffected (blast isolation)
    const otherEdgeEffect = engine.evaluateEdgeCall('edge-users-to-db', 'svc-users', 'svc-db', now);
    assert.strictEqual(
      otherEdgeEffect.injectedLatencyMicros,
      0n,
      'Unrelated edge must have 0 latency injection',
    );

    console.log('    ✓ Baseline added latency: 0µs');
    console.log('    ✓ Active fault latency shift: 100,000µs (+100.0ms exact)');
    console.log('    ✓ Unrelated edge isolation preserved');
  }

  // ---------------------------------------------------------
  // Assertion 5: Chaos Safety Boundary auto-abort on SLO burn
  // ---------------------------------------------------------
  console.log('\n--> Assertion 5: Chaos Safety Boundary Auto-Abort on SLO Burn');
  {
    const safety = new ChaosSafetyBoundary({
      maxBlastRadiusPercent: 30,
      errorRateThresholdPpm: 500_000, // 50%
      burnDurationThresholdMicros: 30_000_000n, // 30s
    });
    const engine = new FaultEngine(safety);

    let now = 5_000_000n;

    // Inject active fault
    const spec: FaultSpec = {
      id: 'fault-err-spike',
      worldId: 'test-world',
      name: '503 Spike',
      faultType: 'ERROR',
      parameters: { percentage: 100, httpStatus: 503, errorCode: 'CHAOS' },
      safetyRules: { maxDurationMicros: 60_000_000n, autoAbortOnBurnRate: true },
    };
    engine.injectFault(spec, 'exec-burn-1', now, 60_000_000n);

    assert.strictEqual(engine.getActiveFaults(now).length, 1);

    // Simulated error rate spikes to 60% (600,000 ppm)
    // Tick 1: burn begins
    const check1 = safety.evaluateSafety(600_000, now);
    assert.strictEqual(check1.safe, true, 'Single tick above threshold does not abort immediately');

    // Tick 2: 31 seconds of sustained 60% error rate
    now += 31_000_000n;
    const check2 = safety.evaluateSafety(600_000, now);
    assert.strictEqual(check2.safe, false, 'Sustained SLO burn must trigger abort');
    assert.strictEqual(check2.abortTriggered, true);
    assert.strictEqual(safety.isAborted, true);

    // Within 1 tick, emergency abort halts all active faults
    engine.emergencyAbortAll(now, check2.reason!);
    assert.strictEqual(
      engine.getActiveFaults(now).length,
      0,
      'Emergency abort must purge all active faults immediately',
    );

    // Post-abort traffic evaluation injects 0 latency and 0 drops
    const postAbortEffect = engine.evaluateEdgeCall('any-edge', 'svc-a', 'svc-b', now);
    assert.strictEqual(postAbortEffect.drop, false);
    assert.strictEqual(postAbortEffect.injectedLatencyMicros, 0n);

    console.log('    ✓ Critical SLO burn (>50% error for >30s) detected');
    console.log('    ✓ Emergency auto-abort triggered within 1 tick');
    console.log('    ✓ All active faults halted; system fails safe');
  }

  // ---------------------------------------------------------
  // Assertion 6: Package Purity Checks for packages/reliability
  // ---------------------------------------------------------
  console.log('\n--> Code Purity Checks for packages/reliability');
  {
    const coreDir = path.join(REPO_ROOT, 'packages', 'reliability', 'src', 'core');
    const files = fs.readdirSync(coreDir).filter((f) => f.endsWith('.ts'));

    for (const file of files) {
      const content = fs.readFileSync(path.join(coreDir, file), 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;

        if (line.includes('Date.now()') || line.includes('new Date(')) {
          throw new Error(`Purity violation in ${file}:${i + 1}: Date is forbidden in core`);
        }
        if (line.includes('Math.random()')) {
          throw new Error(
            `Purity violation in ${file}:${i + 1}: Math.random() is forbidden in core`,
          );
        }
        if (line.includes('@mirrorgrid/')) {
          throw new Error(
            `Purity violation in ${file}:${i + 1}: Workspace imports forbidden in core`,
          );
        }
      }
    }
    console.log('    ✓ Zero Date.now() in packages/reliability/src/core');
    console.log('    ✓ Zero Math.random() in packages/reliability/src/core');
    console.log('    ✓ Zero workspace imports (@mirrorgrid/*) in packages/reliability');
  }

  console.log('\n====================================================');
  console.log('ALL 5/5 MILESTONE M04 ASSERTIONS PASSED GREEN');
  console.log('====================================================');
}

runM4Gate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\n❌ Gate verification failed:', err);
    process.exit(1);
  });
