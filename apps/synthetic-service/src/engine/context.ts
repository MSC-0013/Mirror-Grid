import crypto from 'node:crypto';
import { DeadlineContext, DEADLINE_HEADER } from '@mirrorgrid/reliability';

export interface TraceContext {
  readonly traceId: string;
  readonly parentSpanId: string;
  readonly currentSpanId: string;
  readonly sampled: boolean;
}

export function parseTraceParent(headerValue?: string | string[]): TraceContext {
  const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;

  if (raw) {
    const parts = raw.trim().split('-');
    if (
      parts.length === 4 &&
      parts[0] === '00' &&
      parts[1].length === 32 &&
      parts[2].length === 16
    ) {
      return {
        traceId: parts[1],
        parentSpanId: parts[2],
        currentSpanId: crypto.randomBytes(8).toString('hex'),
        sampled: parts[3] === '01',
      };
    }
  }

  // Generate new trace context if absent or malformed
  return {
    traceId: crypto.randomBytes(16).toString('hex'),
    parentSpanId: '0000000000000000',
    currentSpanId: crypto.randomBytes(8).toString('hex'),
    sampled: true,
  };
}

export function formatTraceParent(ctx: TraceContext): string {
  const flags = ctx.sampled ? '01' : '00';
  return `00-${ctx.traceId}-${ctx.currentSpanId}-${flags}`;
}

export function extractDeadline(
  headers: Record<string, string | string[] | undefined>,
): DeadlineContext | null {
  const raw = headers[DEADLINE_HEADER] ?? headers[DEADLINE_HEADER.toLowerCase()];
  return DeadlineContext.parse(raw);
}
