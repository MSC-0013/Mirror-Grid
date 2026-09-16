/**
 * Google SRE Multi-Window Multi-Burn-Rate alerting engine.
 *
 * Implements Google SRE Workbook (Chapter 5) multi-window alerting:
 * - P1 Critical: 14.4x burn rate over 1h (long) AND 5m (short) -> 2% budget in 1h
 * - P2 High:     6.0x burn rate over 6h (long) AND 30m (short) -> 5% budget in 6h
 * - P3 Warning:  1.0x burn rate over 3d (long) AND 6h (short)  -> 10% budget in 3d
 *
 * The short window guarantees that alerts fire ONLY while the incident is actively occurring,
 * completely eliminating ghost alerts and false alarms from transient spikes that have already self-healed.
 */

export type AlertSeverity = 'P1_CRITICAL' | 'P2_HIGH' | 'P3_WARNING';

export interface BurnRateRule {
  readonly severity: AlertSeverity;
  readonly burnRateThreshold: number;
  readonly longWindowSeconds: number;
  readonly shortWindowSeconds: number;
  readonly budgetPercentTarget: number;
}

export const STANDARD_SRE_BURN_RULES: readonly BurnRateRule[] = [
  {
    severity: 'P1_CRITICAL',
    burnRateThreshold: 14.4,
    longWindowSeconds: 3600, // 1 hour
    shortWindowSeconds: 300, // 5 minutes
    budgetPercentTarget: 2.0,
  },
  {
    severity: 'P2_HIGH',
    burnRateThreshold: 6.0,
    longWindowSeconds: 21600, // 6 hours
    shortWindowSeconds: 1800, // 30 minutes
    budgetPercentTarget: 5.0,
  },
  {
    severity: 'P3_WARNING',
    burnRateThreshold: 1.0,
    longWindowSeconds: 259200, // 3 days (72 hours)
    shortWindowSeconds: 21600, // 6 hours
    budgetPercentTarget: 10.0,
  },
];

export interface WindowMetrics {
  readonly totalRequests: number;
  readonly badRequests: number;
}

export interface BurnRateEvaluationResult {
  readonly severity: AlertSeverity;
  readonly shouldAlert: boolean;
  readonly burnRateThreshold: number;
  readonly longWindowBurnRate: number;
  readonly shortWindowBurnRate: number;
  readonly longWindowSeconds: number;
  readonly shortWindowSeconds: number;
  readonly budgetConsumedPercent: number;
  readonly reason: string;
}

/**
 * Calculates raw burn rate: (badRequests / totalRequests) / (1 - targetPercentage/100).
 */
export function calculateBurnRate(
  totalRequests: number,
  badRequests: number,
  targetPercentage: number,
): number {
  if (totalRequests <= 0) {
    return 0.0;
  }
  const allowableFraction = Math.max(1e-9, 1.0 - targetPercentage / 100);
  const badFraction = badRequests / totalRequests;
  return Number((badFraction / allowableFraction).toFixed(4));
}

/**
 * Evaluates a single multi-window burn rate rule against long and short window metrics.
 */
export function evaluateBurnRateRule(
  rule: BurnRateRule,
  targetPercentage: number,
  longWindow: WindowMetrics,
  shortWindow: WindowMetrics,
  sloWindowSeconds: number = 2592000, // 30 days
): BurnRateEvaluationResult {
  const longBurn = calculateBurnRate(longWindow.totalRequests, longWindow.badRequests, targetPercentage);
  const shortBurn = calculateBurnRate(shortWindow.totalRequests, shortWindow.badRequests, targetPercentage);

  // Both long AND short window must meet or exceed threshold
  const shouldAlert = longBurn >= rule.burnRateThreshold && shortBurn >= rule.burnRateThreshold;

  // Fraction of total SLO budget consumed in the long window
  // Budget percent consumed = (burnRate * longWindowSeconds / sloWindowSeconds) * 100
  const budgetConsumedPercent = Number(
    ((longBurn * rule.longWindowSeconds) / sloWindowSeconds * 100).toFixed(3),
  );

  let reason = '';
  if (shouldAlert) {
    reason = `ALERT [${rule.severity}]: Active burn rate confirmed. Long window: ${longBurn}x (>= ${rule.burnRateThreshold}x), Short window: ${shortBurn}x (>= ${rule.burnRateThreshold}x). Consumed ~${budgetConsumedPercent}% of budget.`;
  } else if (longBurn >= rule.burnRateThreshold && shortBurn < rule.burnRateThreshold) {
    reason = `SUPPRESSED [${rule.severity}]: Transient spike detected. Long window elevated (${longBurn}x >= ${rule.burnRateThreshold}x) but short window normalized (${shortBurn}x < ${rule.burnRateThreshold}x). Incident self-healed.`;
  } else {
    reason = `OK: Burn rates within bounds (Long: ${longBurn}x, Short: ${shortBurn}x, Threshold: ${rule.burnRateThreshold}x).`;
  }

  return {
    severity: rule.severity,
    shouldAlert,
    burnRateThreshold: rule.burnRateThreshold,
    longWindowBurnRate: longBurn,
    shortWindowBurnRate: shortBurn,
    longWindowSeconds: rule.longWindowSeconds,
    shortWindowSeconds: rule.shortWindowSeconds,
    budgetConsumedPercent,
    reason,
  };
}

/**
 * Evaluates all standard Google SRE burn rate rules and returns alerts in order of priority (P1, P2, P3).
 */
export function evaluateAllBurnRateRules(
  targetPercentage: number,
  windows: {
    long1h: WindowMetrics;
    short5m: WindowMetrics;
    long6h?: WindowMetrics;
    short30m?: WindowMetrics;
    long3d?: WindowMetrics;
    short6h?: WindowMetrics;
  },
  sloWindowSeconds: number = 2592000,
): BurnRateEvaluationResult[] {
  const results: BurnRateEvaluationResult[] = [];

  // P1 Critical
  results.push(
    evaluateBurnRateRule(
      STANDARD_SRE_BURN_RULES[0]!,
      targetPercentage,
      windows.long1h,
      windows.short5m,
      sloWindowSeconds,
    ),
  );

  // P2 High
  if (windows.long6h && windows.short30m) {
    results.push(
      evaluateBurnRateRule(
        STANDARD_SRE_BURN_RULES[1]!,
        targetPercentage,
        windows.long6h,
        windows.short30m,
        sloWindowSeconds,
      ),
    );
  }

  // P3 Warning
  if (windows.long3d && windows.short6h) {
    results.push(
      evaluateBurnRateRule(
        STANDARD_SRE_BURN_RULES[2]!,
        targetPercentage,
        windows.long3d,
        windows.short6h,
        sloWindowSeconds,
      ),
    );
  }

  return results;
}
