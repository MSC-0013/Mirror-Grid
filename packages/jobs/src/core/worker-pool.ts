import { leaseManager } from './lease-manager.js';
import type { JobDefinition, JobHandler } from './types.js';

export interface WorkerPoolOptions {
  workerId?: string;
  queues?: string[];
  concurrency?: number;
  pollIntervalMs?: number;
  leaseDurationMs?: number;
}

export class WorkerPool {
  private readonly workerId: string;
  private readonly queues: string[];
  private readonly concurrency: number;
  private readonly pollIntervalMs: number;
  private readonly leaseDurationMs: number;
  private readonly handlers = new Map<string, JobHandler>();

  private isRunning = false;
  private activeWorkers = 0;
  private stopPromiseResolve: (() => void) | null = null;

  constructor(options: WorkerPoolOptions = {}) {
    this.workerId =
      options.workerId ?? `worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
    this.queues = options.queues ?? ['default'];
    this.concurrency = Math.max(1, options.concurrency ?? 4);
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
    this.leaseDurationMs = options.leaseDurationMs ?? 30000;
  }

  public registerHandler(jobType: string, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    for (let i = 0; i < this.concurrency; i++) {
      void this.workerLoop();
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;

    if (this.activeWorkers > 0) {
      await new Promise<void>((resolve) => {
        this.stopPromiseResolve = resolve;
      });
    }
  }

  private async workerLoop(): Promise<void> {
    while (this.isRunning) {
      let job: JobDefinition | null = null;

      try {
        job = await leaseManager.claimJob({
          workerId: this.workerId,
          queues: this.queues,
          leaseDurationMs: this.leaseDurationMs,
        });

        if (job) {
          this.activeWorkers++;
          await this.executeJob(job);
          this.activeWorkers--;
        } else {
          // No job available, idle wait
          await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
        }
      } catch {
        if (job) {
          this.activeWorkers = Math.max(0, this.activeWorkers - 1);
        }
        await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
      }

      if (!this.isRunning && this.activeWorkers === 0 && this.stopPromiseResolve) {
        this.stopPromiseResolve();
      }
    }
  }

  private async executeJob(job: JobDefinition): Promise<void> {
    const handler = this.handlers.get(job.jobType);

    if (!handler) {
      await leaseManager.failJob(
        job.id,
        this.workerId,
        new Error(`No registered handler for job type: '${job.jobType}'`),
      );
      return;
    }

    // Set up auto-renew interval while processing
    const renewInterval = setInterval(
      () => {
        void leaseManager.renewLease(job.id, this.workerId, this.leaseDurationMs);
      },
      Math.floor(this.leaseDurationMs / 2),
    );

    try {
      await handler(job);
      await leaseManager.completeJob(job.id, this.workerId);
    } catch (err) {
      await leaseManager.failJob(job.id, this.workerId, err instanceof Error ? err : String(err));
    } finally {
      clearInterval(renewInterval);
    }
  }
}
