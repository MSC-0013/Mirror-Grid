export class HealthMonitor {
  public async waitForHealthy(
    port: number,
    timeoutMs = 10_000,
    intervalMs = 150,
  ): Promise<boolean> {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { status?: string };
          if (body.status === 'ready') {
            return true;
          }
        }
      } catch {
        // Wait and retry
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }

  public async checkHealth(port: number): Promise<{ healthy: boolean; status: string }> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (res.ok) {
        return { healthy: true, status: 'HEALTHY' };
      }
      return { healthy: false, status: 'UNHEALTHY' };
    } catch {
      return { healthy: false, status: 'UNHEALTHY' };
    }
  }
}
