import { W3CTraceContext, type TraceContext } from './w3c.js';
import { runWithTraceContext, getCurrentTraceContext } from './context.js';
import { SpanCollector, type SpanData } from './span-collector.js';

export interface SpanOptions {
  readonly worldId: string;
  readonly serviceName: string;
  readonly serviceId?: string;
  readonly parentContext?: TraceContext;
  readonly spanKind?: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
  readonly attributes?: Record<string, unknown>;
}

export class Span {
  private readonly worldId: string;
  private readonly traceId: string;
  private readonly spanId: string;
  private readonly parentSpanId?: string;
  private readonly serviceName: string;
  private readonly serviceId?: string;
  private readonly operationName: string;
  private readonly spanKind: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
  private readonly startTimeMicros: number;
  private durationMicros = 0;
  private statusCode: 'OK' | 'ERROR' | 'UNSET' = 'OK';
  private statusMessage?: string;
  private attributes: Record<string, unknown> = {};
  private events: unknown[] = [];
  private isEnded = false;

  constructor(operationName: string, options: SpanOptions) {
    this.operationName = operationName;
    this.worldId = options.worldId;
    this.serviceName = options.serviceName;
    this.serviceId = options.serviceId;
    this.spanKind = options.spanKind ?? 'INTERNAL';

    const parent = options.parentContext ?? getCurrentTraceContext();
    if (parent) {
      const child = W3CTraceContext.createChildContext(parent);
      this.traceId = child.traceId;
      this.spanId = child.spanId;
      this.parentSpanId = child.parentSpanId;
    } else {
      const root = W3CTraceContext.createRootContext();
      this.traceId = root.traceId;
      this.spanId = root.spanId;
    }

    this.startTimeMicros = Math.floor(performance.now() * 1000);
    if (options.attributes) {
      this.attributes = { ...options.attributes };
    }
  }

  public getContext(): TraceContext {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      traceFlags: 1,
    };
  }

  public setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  public setAttributes(attrs: Record<string, unknown>): this {
    Object.assign(this.attributes, attrs);
    return this;
  }

  public setStatus(code: 'OK' | 'ERROR' | 'UNSET', message?: string): this {
    this.statusCode = code;
    this.statusMessage = message;
    return this;
  }

  public addEvent(name: string, attributes: Record<string, unknown> = {}): this {
    this.events.push({
      name,
      timeMicros: Math.floor(performance.now() * 1000),
      attributes,
    });
    return this;
  }

  public end(): void {
    if (this.isEnded) return;
    this.isEnded = true;
    const nowMicros = Math.floor(performance.now() * 1000);
    this.durationMicros = Math.max(1, nowMicros - this.startTimeMicros);

    const spanData: SpanData = {
      worldId: this.worldId,
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      serviceId: this.serviceId,
      serviceName: this.serviceName,
      operationName: this.operationName,
      spanKind: this.spanKind,
      startTimeMicros: this.startTimeMicros,
      durationMicros: this.durationMicros,
      statusCode: this.statusCode,
      statusMessage: this.statusMessage,
      attributes: this.attributes,
      events: this.events,
    };

    SpanCollector.getInstance().record(spanData);
  }
}

export class Tracer {
  public static startSpan(operationName: string, options: SpanOptions): Span {
    return new Span(operationName, options);
  }

  public static async withSpan<T>(
    operationName: string,
    options: SpanOptions,
    fn: (span: Span) => Promise<T>,
  ): Promise<T> {
    const span = new Span(operationName, options);
    return runWithTraceContext(span.getContext(), async () => {
      try {
        const result = await fn(span);
        return result;
      } catch (err) {
        span.setStatus('ERROR', err instanceof Error ? err.message : String(err));
        throw err;
      } finally {
        span.end();
      }
    });
  }
}
