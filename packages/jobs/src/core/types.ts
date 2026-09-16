export type JobStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTER'
  | 'CANCELLED';

export interface JobDefinition {
  id: string;
  queueName: string;
  jobType: string;
  payload: Record<string, unknown>;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  runAt: Date;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EnqueueOptions {
  queueName?: string;
  priority?: number;
  maxAttempts?: number;
  delayMs?: number;
}

export interface ClaimOptions {
  workerId: string;
  queues?: string[];
  leaseDurationMs?: number;
}

export type JobHandler = (job: JobDefinition) => Promise<void>;
