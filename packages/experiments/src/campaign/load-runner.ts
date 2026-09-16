import type { LoadTestConfig, LoadTestResult, LatencyProfile } from './types.js';

export class LoadRunner {
  /**
   * Executes a high-throughput load benchmark, profiling latency percentiles and sustained RPS.
   */
  static async execute(
    config: LoadTestConfig,
    workloadFn?: (reqIndex: number) => Promise<boolean> | boolean,
  ): Promise<LoadTestResult> {
    const total = config.totalRequests;
    const concurrency = config.concurrency ?? 500;
    const latencies: number[] = new Array(total);
    let successful = 0;
    let failed = 0;

    const fn = workloadFn ?? (async () => true);

    const startTime = performance.now();

    // Process in batches matching concurrency limit to avoid event loop starvation
    for (let i = 0; i < total; i += concurrency) {
      const batchSize = Math.min(concurrency, total - i);
      const batchPromises: Promise<void>[] = [];

      for (let j = 0; j < batchSize; j++) {
        const index = i + j;
        batchPromises.push(
          (async () => {
            const reqStart = performance.now();
            try {
              const ok = await fn(index);
              if (ok) {
                successful++;
              } else {
                failed++;
              }
            } catch {
              failed++;
            } finally {
              const reqEnd = performance.now();
              latencies[index] = Number((reqEnd - reqStart).toFixed(4));
            }
          })(),
        );
      }

      await Promise.all(batchPromises);
    }

    const endTime = performance.now();
    const durationMs = Math.max(1, endTime - startTime);
    const actualRps = Number(((total / durationMs) * 1000).toFixed(2));

    // Sort latencies to compute percentiles
    latencies.sort((a, b) => a - b);

    const sum = latencies.reduce((acc, v) => acc + v, 0);
    const meanMs = Number((sum / total).toFixed(4));
    const minMs = latencies[0] ?? 0;
    const maxMs = latencies[total - 1] ?? 0;
    const p50Ms = latencies[Math.floor(total * 0.5)] ?? 0;
    const p90Ms = latencies[Math.floor(total * 0.9)] ?? 0;
    const p99Ms = latencies[Math.floor(total * 0.99)] ?? 0;

    const profile: LatencyProfile = {
      minMs,
      maxMs,
      meanMs,
      p50Ms,
      p90Ms,
      p99Ms,
    };

    return {
      totalRequests: total,
      successfulRequests: successful,
      failedRequests: failed,
      durationMs: Number(durationMs.toFixed(2)),
      actualRps,
      latencies: profile,
    };
  }
}
