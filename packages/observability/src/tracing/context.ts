import { AsyncLocalStorage } from 'node:async_hooks';
import type { TraceContext } from './w3c.js';

export const traceStorage = new AsyncLocalStorage<TraceContext>();

export function runWithTraceContext<T>(context: TraceContext, fn: () => T): T {
  return traceStorage.run(context, fn);
}

export function getCurrentTraceContext(): TraceContext | undefined {
  return traceStorage.getStore();
}
