import type { RcaInvestigationResult } from '../rca/rca-engine.js';
import type { ErrorBudgetStatus } from '../slo/error-budget.js';

export interface SreRecommendation {
  readonly id: string;
  readonly category: 'RESILIENCE' | 'CAPACITY' | 'OBSERVABILITY' | 'CIRCUIT_BREAKING';
  readonly priority: 'P1' | 'P2' | 'P3';
  readonly targetService: string;
  readonly title: string;
  readonly action: string;
}

export function generateRecommendations(
  rca: RcaInvestigationResult,
  budgets: readonly ErrorBudgetStatus[],
): SreRecommendation[] {
  const recommendations: SreRecommendation[] = [];

  // RCA-driven recommendation
  recommendations.push({
    id: 'rec-rca-1',
    category: 'CIRCUIT_BREAKING',
    priority: 'P1',
    targetService: rca.rootCauseServiceName,
    title: `Isolate ${rca.rootCauseServiceName} with Circuit Breaker & Bulkhead`,
    action: rca.architecturalRecommendation,
  });

  // Upstream shielding recommendation
  if (rca.causalPath.length > 1) {
    const upstreamCaller = rca.causalPath[rca.causalPath.length - 2];
    if (upstreamCaller) {
      recommendations.push({
        id: 'rec-upstream-1',
        category: 'RESILIENCE',
        priority: 'P2',
        targetService: upstreamCaller.serviceName,
        title: `Configure Short Timeout on Calls to ${rca.rootCauseServiceName}`,
        action: `Set request timeout on '${upstreamCaller.serviceName}' to fail-fast within 200ms when calling '${rca.rootCauseServiceName}' to prevent thread pool exhaustion.`,
      });
    }
  }

  // Budget-driven recommendations
  for (const b of budgets) {
    if (b.budgetRemainingPercent < 20.0) {
      recommendations.push({
        id: `rec-budget-${b.sloId}`,
        category: 'CAPACITY',
        priority: 'P1',
        targetService: b.sloId,
        title: `Freeze Non-Critical Deployments (SLO Budget at ${b.budgetRemainingPercent}%)`,
        action: `Error budget nearly exhausted (${b.budgetRemainingPercent}% remaining). Institute deployment freeze and prioritize reliability remediation.`,
      });
    }
  }

  return recommendations;
}
