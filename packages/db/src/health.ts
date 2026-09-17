import type { HealthProbe, HealthCheckResult } from '@mirrorgrid/platform';
import { queryClient } from './client.js';

export class DbHealthProbe implements HealthProbe {
  public readonly name = 'database';
  public readonly isCritical = true;

  public async check(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await queryClient.query('SELECT 1');
      const latencyMs = Date.now() - start;
      return {
        status: latencyMs > 1000 ? 'DEGRADED' : 'HEALTHY',
        latencyMs,
        message: latencyMs > 1000 ? 'High latency to MySQL' : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        status: 'UNHEALTHY',
        message: `Database connection failed: ${msg}`,
        latencyMs: Date.now() - start,
      };
    }
  }
}
