export { AppError } from './errors/app-error.js';
export type { ErrorEnvelope } from './errors/app-error.js';

export {
  getCorrelationContext,
  runWithCorrelationContext,
  generateId,
} from './context/correlation.js';
export type { CorrelationContext } from './context/correlation.js';

export { HealthAggregator } from './health/health-probe.js';
export type {
  HealthStatus,
  HealthCheckResult,
  HealthProbe,
  ComponentHealthReport,
  ServiceHealthReport,
} from './health/health-probe.js';
