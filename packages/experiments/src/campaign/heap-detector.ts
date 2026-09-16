import type { HeapProfileResult } from './types.js';

export class HeapLeakDetector {
  /**
   * Profiles heap stability before and after a workload execution to detect memory leaks.
   */
  static async profile(
    workload: () => Promise<void>,
    options?: { thresholdBytes?: number },
  ): Promise<HeapProfileResult> {
    const threshold = options?.thresholdBytes ?? 10 * 1024 * 1024; // 10 MB default

    // Attempt GC before baseline measurement if exposed
    if (typeof global.gc === 'function') {
      global.gc();
    }

    const initialHeapBytes = process.memoryUsage().heapUsed;

    await workload();

    // Allow any pending microtasks to drain
    await new Promise((resolve) => setTimeout(resolve, 50));

    if (typeof global.gc === 'function') {
      global.gc();
    }

    const finalHeapBytes = process.memoryUsage().heapUsed;
    const deltaBytes = Math.max(0, finalHeapBytes - initialHeapBytes);
    const peakHeapBytes = process.memoryUsage().heapTotal;

    const isLeakDetected = deltaBytes > threshold;

    return {
      initialHeapBytes,
      finalHeapBytes,
      deltaBytes,
      peakHeapBytes,
      isLeakDetected,
      thresholdBytes: threshold,
    };
  }
}
