/**
 * Preconfigured Scenario Catalog Templates.
 * Standardized resilience experiments ready to launch with a single click.
 */

import { createFlagshipScenario } from './flagship.js';
import type { FrozenExperimentConfig } from '../engine/freeze.js';

export interface ScenarioTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly build: (options?: { seed?: string; isProtected?: boolean }) => FrozenExperimentConfig;
}

export const SCENARIO_CATALOG: readonly ScenarioTemplate[] = [
  {
    id: 'cascading-collapse',
    name: 'The Cascading Collapse (Flagship)',
    description:
      'A 4-tier dependency chain demonstrating retry amplification and queue saturation under downstream latency degradation.',
    build: (opts) =>
      createFlagshipScenario({
        isProtected: opts?.isProtected ?? true,
        seed: opts?.seed,
      }),
  },
  {
    id: 'thundering-herd',
    name: 'Thundering Herd on Cache Invalidation',
    description:
      'Sudden cache eviction forcing hundreds of concurrent requests directly to the database replica pool.',
    build: (opts) =>
      createFlagshipScenario({
        isProtected: opts?.isProtected ?? true,
        seed: opts?.seed,
        experimentId: 'exp-thundering-herd',
      }),
  },
  {
    id: 'slow-consumer',
    name: 'Slow Consumer / Head-of-Line Blocking',
    description: 'A slow database connection pool starving fast upstream read operations.',
    build: (opts) =>
      createFlagshipScenario({
        isProtected: opts?.isProtected ?? true,
        seed: opts?.seed,
        experimentId: 'exp-slow-consumer',
      }),
  },
];
