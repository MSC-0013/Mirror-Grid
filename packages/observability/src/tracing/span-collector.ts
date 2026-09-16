import { db, traceSpans } from '@mirrorgrid/db';

export interface SpanData {
  readonly id?: string;
  readonly worldId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly serviceId?: string;
  readonly serviceName: string;
  readonly operationName: string;
  readonly spanKind?: 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER' | 'INTERNAL';
  readonly startTimeMicros: number;
  readonly durationMicros: number;
  readonly statusCode: 'OK' | 'ERROR' | 'UNSET';
  readonly statusMessage?: string;
  readonly attributes: Record<string, unknown>;
  readonly events?: unknown[];
}

export class SpanCollector {
  private static instance: SpanCollector | null = null;
  private buffer: SpanData[] = [];
  private timer: NodeJS.Timeout | null = null;
  private isFlushing = false;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  constructor(batchSize = 50, flushIntervalMs = 200) {
    this.batchSize = batchSize;
    this.flushIntervalMs = flushIntervalMs;
    this.startTimer();
  }

  public static getInstance(): SpanCollector {
    if (!SpanCollector.instance) {
      SpanCollector.instance = new SpanCollector();
    }
    return SpanCollector.instance;
  }

  public static resetInstance(): void {
    if (SpanCollector.instance) {
      SpanCollector.instance.stopTimer();
      SpanCollector.instance = null;
    }
  }

  private startTimer(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  public record(span: SpanData): void {
    this.buffer.push(span);
    if (this.buffer.length >= this.batchSize) {
      void this.flush();
    }
  }

  public async flush(): Promise<number> {
    if (this.isFlushing || this.buffer.length === 0) {
      return 0;
    }
    this.isFlushing = true;
    const batch = this.buffer.splice(0, this.batchSize);

    try {
      const rows = batch.map((s) => ({
        id: s.id ?? crypto.randomUUID(),
        worldId: s.worldId,
        traceId: s.traceId,
        spanId: s.spanId,
        parentSpanId: s.parentSpanId ?? null,
        serviceId: s.serviceId ?? null,
        serviceName: s.serviceName,
        operationName: s.operationName,
        spanKind: s.spanKind ?? 'INTERNAL',
        startTimeMicros: s.startTimeMicros,
        durationMicros: s.durationMicros,
        statusCode: s.statusCode,
        statusMessage: s.statusMessage ?? null,
        attributes: s.attributes,
        events: s.events ?? [],
        createdAt: new Date(),
      }));

      await db.insert(traceSpans).values(rows);
      return rows.length;
    } catch (err) {
      console.error('[SpanCollector] Failed to flush spans batch:', err);
      // Re-insert unwritten spans at beginning of buffer
      this.buffer.unshift(...batch);
      return 0;
    } finally {
      this.isFlushing = false;
    }
  }

  public async close(): Promise<void> {
    this.stopTimer();
    while (this.buffer.length > 0) {
      await this.flush();
    }
  }
}
