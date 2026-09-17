/**
 * tests/gates/verify-flagship.ts
 *
 * MIRRORGRID Milestone M05 Verification Gate:
 * Experiment Engine & Flagship Cascading Collapse Scenario (Tier 1 / v0.1 Release Certification)
 *
 * Asserts:
 *  1. Unprotected run exhibits catastrophic retry amplification (>= 2.5x traffic).
 *  2. Protected run trips circuit breaker to OPEN within 3 seconds of fault injection (MTTD <= 3.0s).
 *  3. Retry budget strictly caps retry amplification under 1.15x during active failure.
 *  4. System cleanly recovers after fault removal with verifiable MTTR (MTTR <= 10.0s).
 *  5. Repeated runs with identical PRNG seed reproduce exact canonical state hash bit-for-bit.
 */

import assert from 'node:assert';
import {
  createFlagshipScenario,
  ExperimentOrchestrator,
  type ExperimentRunSummary,
} from '../../packages/experiments/src/index.js';

async function runFlagshipGate() {
  console.log('====================================================');
  console.log('MIRRORGRID GATE VERIFICATION: Milestone M05');
  console.log('Experiment Engine, Flagship Demo & Tier 1 / v0.1 Release');
  console.log('====================================================\n');

  // Fast-clock durations for CI verification
  const baselineMicros = 15_000_000n; // 15s baseline
  const faultMicros = 20_000_000n; // 20s fault (+400ms latency)
  const cooldownMicros = 15_000_000n; // 15s cooldown

  // -----------------------------------------------------------------
  // 1. Run A: The Unprotected Collapse
  // -----------------------------------------------------------------
  console.log('--> Executing Flagship Run A: Unprotected Graph (The Collapse)...');
  const unprotectedConfig = createFlagshipScenario({
    isProtected: false,
    baselineDurationMicros: baselineMicros,
    faultDurationMicros: faultMicros,
    cooldownDurationMicros: cooldownMicros,
    seed: '42',
  });

  const unprotectedOrchestrator = new ExperimentOrchestrator({
    config: unprotectedConfig,
    runNumber: 1,
    runtimeMode: 'LOGICAL',
  });

  const unprotectedSummary: ExperimentRunSummary = await unprotectedOrchestrator.execute('FAST');

  const unprotectedAmplification = unprotectedSummary.retryAmplificationFactor;
  console.log(`    Total Initial Invocations: ${unprotectedSummary.totalInitialRequests}`);
  console.log(`    Total Retries Attempted:   ${unprotectedSummary.totalRetriedRequests}`);
  console.log(`    Retry Amplification:       ${unprotectedAmplification.toFixed(2)}x`);
  console.log(
    `    Peak Error Rate:           ${unprotectedSummary.peakErrorRatePercent.toFixed(1)}%`,
  );

  // Assertion 1: Unprotected run exhibits catastrophic retry amplification (>= 2.5x traffic)
  assert(
    unprotectedAmplification >= 2.5,
    `Assertion 1 Failed: Expected retry amplification >= 2.5x, but got ${unprotectedAmplification.toFixed(2)}x`,
  );
  console.log(
    '    ✓ Assertion 1: Catastrophic retry amplification (>= 2.5x) observed in unprotected graph\n',
  );

  // -----------------------------------------------------------------
  // 2. Run B: Protected Resilience (The Shield)
  // -----------------------------------------------------------------
  console.log('--> Executing Flagship Run B: Protected Graph (The Shield)...');
  const protectedConfig = createFlagshipScenario({
    isProtected: true,
    baselineDurationMicros: baselineMicros,
    faultDurationMicros: faultMicros,
    cooldownDurationMicros: cooldownMicros,
    seed: '42',
  });

  const protectedOrchestrator = new ExperimentOrchestrator({
    config: protectedConfig,
    runNumber: 2,
    runtimeMode: 'LOGICAL',
  });

  const protectedSummary: ExperimentRunSummary = await protectedOrchestrator.execute('FAST');

  const mttdSeconds = protectedSummary.mttdMicros
    ? Number(protectedSummary.mttdMicros) / 1_000_000
    : 0;
  const mttrSeconds = protectedSummary.mttrMicros
    ? Number(protectedSummary.mttrMicros) / 1_000_000
    : 0;

  const breakerTrippedEvents = protectedSummary.timeline.filter(
    (e) => e.eventCategory === 'BREAKER_STATE' && e.summary.includes('OPEN'),
  );
  const breakerTripped = breakerTrippedEvents.length > 0;

  console.log(`    Breaker OPEN Events:       ${breakerTrippedEvents.length}`);
  console.log(`    Measured MTTD:             ${mttdSeconds.toFixed(2)}s`);
  console.log(`    Measured MTTR:             ${mttrSeconds.toFixed(2)}s`);
  console.log(
    `    Protected Amplification:   ${protectedSummary.retryAmplificationFactor.toFixed(2)}x`,
  );

  // Assertion 2: Protected run trips circuit breaker to OPEN rapidly (MTTD <= 3.0s)
  assert(
    breakerTripped && mttdSeconds <= 3.0,
    `Assertion 2 Failed: Circuit breaker should trip within 3.0s (tripped: ${breakerTripped}, MTTD: ${mttdSeconds.toFixed(2)}s)`,
  );
  console.log(
    `    ✓ Assertion 2: Circuit breaker tripped to OPEN in ${mttdSeconds.toFixed(2)}s (MTTD <= 3.0s)`,
  );

  // Assertion 3: Retry budget caps retry amplification under 1.15x during active failure
  assert(
    protectedSummary.retryAmplificationFactor <= 1.15,
    `Assertion 3 Failed: Retry budget should cap amplification under 1.15x, got ${protectedSummary.retryAmplificationFactor.toFixed(2)}x`,
  );
  console.log(
    `    ✓ Assertion 3: Retry budget strictly capped traffic amplification to ${protectedSummary.retryAmplificationFactor.toFixed(2)}x (<= 1.15x)`,
  );

  // Assertion 4: System cleanly recovers after fault removal with verifiable MTTR (MTTR <= 10.0s)
  const systemRecovered =
    protectedSummary.status === 'COMPLETED' && mttrSeconds > 0 && mttrSeconds <= 10.0;
  assert(
    systemRecovered,
    `Assertion 4 Failed: System should recover within 10.0s, got ${mttrSeconds.toFixed(2)}s`,
  );
  console.log(
    `    ✓ Assertion 4: System cleanly recovered in ${mttrSeconds.toFixed(2)}s (MTTR <= 10.0s)\n`,
  );

  // -----------------------------------------------------------------
  // 3. Bit-for-Bit Determinism across repeated runs
  // -----------------------------------------------------------------
  console.log('--> Executing Determinism Replay (Repeated Protected Run with Seed 42)...');
  const replayOrchestrator = new ExperimentOrchestrator({
    config: protectedConfig,
    runNumber: 3,
    runtimeMode: 'LOGICAL',
  });

  const replaySummary: ExperimentRunSummary = await replayOrchestrator.execute('FAST');

  console.log(`    Run 1 State Hash: ${protectedSummary.stateHash}`);
  console.log(`    Run 2 State Hash: ${replaySummary.stateHash}`);

  // Assertion 5: Bit-for-bit identical state hash across runs
  assert.strictEqual(
    protectedSummary.stateHash,
    replaySummary.stateHash,
    'Assertion 5 Failed: Repeated run produced divergent state hash',
  );
  console.log('    ✓ Assertion 5: Bit-for-bit reproducible canonical state hash confirmed\n');

  console.log('====================================================');
  console.log('ALL 5/5 MILESTONE M05 FLAGSHIP ASSERTIONS PASSED GREEN');
  console.log('TIER 1 / v0.1 RELEASE CERTIFIED');
  console.log('====================================================');
}

runFlagshipGate()
  // Explicitly exit on success: the mysql2 connection pool keeps open
  // sockets that hold the Node event loop open indefinitely otherwise,
  // which is not a failure -- the gate already finished -- but looks
  // exactly like a hang from the outside.
  .then(() => process.exit(0))
  .catch((err) => {
  console.error('\nGATE FAILED:', err);
  process.exit(1);
});
