import crypto from 'node:crypto';

export interface TraceContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly traceFlags: number;
}

const TRACE_PARENT_REGEX = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/i;

export class W3CTraceContext {
  public static generateTraceId(): string {
    return crypto.randomBytes(16).toString('hex').toLowerCase();
  }

  public static generateSpanId(): string {
    return crypto.randomBytes(8).toString('hex').toLowerCase();
  }

  public static parseTraceParent(header: string | undefined | null): TraceContext | null {
    if (!header) return null;
    const match = TRACE_PARENT_REGEX.exec(header.trim());
    if (!match) return null;

    const [, version, traceId, spanId, flagsHex] = match;

    // Version 00 check: traceId and spanId cannot be all zeros
    if (version === '00') {
      if (/^0{32}$/.test(traceId) || /^0{16}$/.test(spanId)) {
        return null;
      }
    }

    return {
      traceId: traceId.toLowerCase(),
      spanId: spanId.toLowerCase(),
      traceFlags: parseInt(flagsHex, 16),
    };
  }

  public static serializeTraceParent(context: TraceContext): string {
    const flagsHex = (context.traceFlags & 0xff).toString(16).padStart(2, '0');
    return `00-${context.traceId}-${context.spanId}-${flagsHex}`;
  }

  public static createRootContext(sampled = true): TraceContext {
    return {
      traceId: this.generateTraceId(),
      spanId: this.generateSpanId(),
      traceFlags: sampled ? 1 : 0,
    };
  }

  public static createChildContext(parent: TraceContext): TraceContext {
    return {
      traceId: parent.traceId,
      spanId: this.generateSpanId(),
      parentSpanId: parent.spanId,
      traceFlags: parent.traceFlags,
    };
  }
}
