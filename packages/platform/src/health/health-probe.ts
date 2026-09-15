export type HealthStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

export interface HealthCheckResult {
  status: HealthStatus;
  message?: string;
  latencyMs?: number;
  details?: Record<string, unknown>;
}

export interface HealthProbe {
  readonly name: string;
  readonly isCritical: boolean;
  check(): Promise<HealthCheckResult>;
}

export interface ComponentHealthReport {
  name: string;
  status: HealthStatus;
  isCritical: boolean;
  message?: string;
  latencyMs?: number;
}

export interface ServiceHealthReport {
  status: HealthStatus;
  uptimeSeconds: number;
  timestamp: string;
  components: ComponentHealthReport[];
}

export class HealthAggregator {
  private readonly probes: Map<string, HealthProbe> = new Map();
  private readonly startTime = Date.now();

  public register(probe: HealthProbe): void {
    this.probes.set(probe.name, probe);
  }

  public async getFullReport(): Promise<ServiceHealthReport> {
    const componentReports: ComponentHealthReport[] = [];
    let hasUnhealthyCritical = false;
    let hasDegradedOrUnhealthyNonCritical = false;

    for (const [name, probe] of this.probes.entries()) {
      const start = Date.now();
      try {
        const res = await probe.check();
        const latencyMs = res.latencyMs ?? (Date.now() - start);
        componentReports.push({
          name,
          status: res.status,
          isCritical: probe.isCritical,
          message: res.message,
          latencyMs,
        });

        if (res.status === 'UNHEALTHY' && probe.isCritical) {
          hasUnhealthyCritical = true;
        } else if (res.status !== 'HEALTHY') {
          hasDegradedOrUnhealthyNonCritical = true;
        }
      } catch (err: unknown) {
        const latencyMs = Date.now() - start;
        const msg = err instanceof Error ? err.message : String(err);
        componentReports.push({
          name,
          status: 'UNHEALTHY',
          isCritical: probe.isCritical,
          message: msg,
          latencyMs,
        });
        if (probe.isCritical) {
          hasUnhealthyCritical = true;
        } else {
          hasDegradedOrUnhealthyNonCritical = true;
        }
      }
    }

    let overallStatus: HealthStatus = 'HEALTHY';
    if (hasUnhealthyCritical) {
      overallStatus = 'UNHEALTHY';
    } else if (hasDegradedOrUnhealthyNonCritical) {
      overallStatus = 'DEGRADED';
    }

    return {
      status: overallStatus,
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      components: componentReports,
    };
  }

  public async isReady(): Promise<{ ready: boolean; dependencies: ComponentHealthReport[] }> {
    const report = await this.getFullReport();
    const ready = report.status !== 'UNHEALTHY';
    return {
      ready,
      dependencies: report.components,
    };
  }
}
