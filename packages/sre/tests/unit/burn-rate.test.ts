import assert from 'node:assert';
import {
  calculateBurnRate,
  evaluateBurnRateRule,
  STANDARD_SRE_BURN_RULES,
  calculateErrorBudgetStatus,
} from '../../src/index.js';

console.log('--- Testing Multi-Window Burn Rate Math ---');

// 1. Assert 2% budget consumed in 1 hour outputs burnRate = 14.4
// For 99.9% target (allowable error = 0.1% = 0.001):
// Total 30-day budget = 0.001 * total monthly volume.
// If 2% of budget is consumed in 1h:
// Fraction of budget consumed per hour = 0.02 / (1 / 720) = 14.4x normal rate!
const target = 99.9; // 0.1% error budget
const totalHourlyRequests = 100_000;
// With 99.9% target, 0.1% = 100 allowable errors per 100k requests in steady 1.0x burn.
// For 14.4x burn rate, we have 14.4 * 100 = 1440 bad requests.
const badHourlyRequests = 1440;
const calculatedBurn = calculateBurnRate(totalHourlyRequests, badHourlyRequests, target);

assert.strictEqual(
  Number(calculatedBurn.toFixed(1)),
  14.4,
  `Burn rate must equal 14.4 (got ${calculatedBurn})`,
);
console.log('✓ 2% budget consumed in 1h computes burnRate = 14.4x');

// 2. Dual-window requirement suppresses transient false positives
const p1Rule = STANDARD_SRE_BURN_RULES[0]!;

// Incident that is actively happening (both 1h and 5m elevated)
const activeIncident = evaluateBurnRateRule(
  p1Rule,
  target,
  { totalRequests: 100_000, badRequests: 1440 }, // 1h long window: 14.4x
  { totalRequests: 10_000, badRequests: 150 },   // 5m short window: 15.0x
);
assert.strictEqual(activeIncident.shouldAlert, true, 'Active incident must trigger alert');
console.log('✓ Active incident triggers P1 alert when both long & short windows burn');

// Transient incident (spike happened 30m ago, but last 5m is healthy)
const transientSpike = evaluateBurnRateRule(
  p1Rule,
  target,
  { totalRequests: 100_000, badRequests: 1440 }, // 1h long window: 14.4x
  { totalRequests: 10_000, badRequests: 2 },      // 5m short window: 0.2x (healthy!)
);
assert.strictEqual(
  transientSpike.shouldAlert,
  false,
  'Transient spike must be suppressed when short window normalized',
);
assert.ok(
  transientSpike.reason.includes('SUPPRESSED'),
  'Reason must indicate transient spike suppression',
);
console.log('✓ Transient spike is successfully suppressed without false alarm');

// 3. Error budget remaining and exhaustion projection
const budgetStatus = calculateErrorBudgetStatus({
  sloId: 'slo-test-1',
  targetPercentage: 99.9,
  currentPercentage: 99.95, // only half of allowable budget consumed
  windowSeconds: 2592000,
});
assert.strictEqual(budgetStatus.budgetConsumedPercent, 50.0);
assert.strictEqual(budgetStatus.budgetRemainingPercent, 50.0);
assert.strictEqual(budgetStatus.isBurning, false);
console.log('✓ Error budget accurately tracks consumption and remaining headroom');

console.log('All Burn Rate Unit Tests Passed!\n');
