/**
 * Google SRE Error Budget calculations and status evaluation.
 */

export interface ErrorBudgetStatus {
  readonly sloId: string;
  readonly targetPercentage: number;
  readonly currentPercentage: number;
  readonly budgetRemainingPercent: number; // 0.0 to 100.0
  readonly budgetConsumedPercent: number;
  readonly currentBurnRate: number;
  readonly isBurning: boolean;
  readonly estimatedExhaustionHours?: number;
}

/**
 * Computes Error Budget consumption, remaining budget, and burn rate.
 *
 * @param sloId Unique identifier of the SLO
 * @param targetPercentage Target reliability percentage (e.g. 99.9 for 99.9%)
 * @param currentPercentage Observed reliability percentage over evaluation period
 * @param windowSeconds Duration of the SLO window in seconds (e.g. 2592000 for 30 days)
 * @param totalRequests Total number of requests in current sample window
 * @param badRequests Number of bad (failed or slow) requests in current sample window
 */
export function calculateErrorBudgetStatus(params: {
  sloId: string;
  targetPercentage: number;
  currentPercentage: number;
  windowSeconds?: number;
  totalRequests?: number;
  badRequests?: number;
}): ErrorBudgetStatus {
  const {
    sloId,
    targetPercentage,
    currentPercentage,
    windowSeconds = 2592000,
    totalRequests,
    badRequests,
  } = params;

  const allowableErrorFraction = Math.max(1e-9, 1.0 - targetPercentage / 100);

  // Compute burn rate from requests if available, or from currentPercentage
  let currentBurnRate = 0;
  if (totalRequests !== undefined && badRequests !== undefined && totalRequests > 0) {
    const errorFraction = badRequests / totalRequests;
    currentBurnRate = Number((errorFraction / allowableErrorFraction).toFixed(4));
  } else {
    const observedErrorFraction = Math.max(0, 1.0 - currentPercentage / 100);
    currentBurnRate = Number((observedErrorFraction / allowableErrorFraction).toFixed(4));
  }

  // Budget consumed fraction
  const observedErrorFraction = Math.max(0, 1.0 - currentPercentage / 100);
  const consumedFraction = observedErrorFraction / allowableErrorFraction;
  const budgetConsumedPercent = Number(Math.max(0, consumedFraction * 100).toFixed(3));
  const budgetRemainingPercent = Number(
    Math.max(0, Math.min(100, 100 - budgetConsumedPercent)).toFixed(3),
  );

  const isBurning = currentBurnRate > 1.0;

  let estimatedExhaustionHours: number | undefined;
  if (currentBurnRate > 0 && budgetRemainingPercent > 0) {
    const windowHours = windowSeconds / 3600;
    const hours = (budgetRemainingPercent / 100 / currentBurnRate) * windowHours;
    estimatedExhaustionHours = Number(hours.toFixed(2));
  } else if (budgetRemainingPercent === 0) {
    estimatedExhaustionHours = 0;
  }

  return {
    sloId,
    targetPercentage,
    currentPercentage,
    budgetRemainingPercent,
    budgetConsumedPercent,
    currentBurnRate,
    isBurning,
    estimatedExhaustionHours,
  };
}
