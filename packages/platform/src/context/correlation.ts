import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface CorrelationContext {
  requestId: string;
  correlationId: string;
  actorId?: string;
  worldId?: string;
}

const storage = new AsyncLocalStorage<CorrelationContext>();

export function getCorrelationContext(): CorrelationContext | undefined {
  return storage.getStore();
}

export function runWithCorrelationContext<T>(context: Partial<CorrelationContext>, fn: () => T): T {
  const fullContext: CorrelationContext = {
    requestId: context.requestId || randomUUID(),
    correlationId: context.correlationId || context.requestId || randomUUID(),
    actorId: context.actorId,
    worldId: context.worldId,
  };
  return storage.run(fullContext, fn);
}

export function generateId(): string {
  return randomUUID();
}
