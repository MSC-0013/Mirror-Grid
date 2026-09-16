import { HdrHistogram } from './histogram.js';

export type MetricLabels = Record<string, string>;

interface MetricMetadata {
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
}

export class MetricRegistry {
  private static instance: MetricRegistry | null = null;
  private readonly metadata = new Map<string, MetricMetadata>();
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly histograms = new Map<string, HdrHistogram>();

  public static getInstance(): MetricRegistry {
    if (!MetricRegistry.instance) {
      MetricRegistry.instance = new MetricRegistry();
    }
    return MetricRegistry.instance;
  }

  public static resetInstance(): void {
    if (MetricRegistry.instance) {
      MetricRegistry.instance.clear();
      MetricRegistry.instance = null;
    }
  }

  public registerMetric(name: string, type: 'counter' | 'gauge' | 'histogram', help: string): void {
    this.metadata.set(name, { type, help });
  }

  private serializeLabels(labels?: MetricLabels): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }
    const parts = Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`);
    return `{${parts.join(',')}}`;
  }

  private buildKey(name: string, labels?: MetricLabels): string {
    return `${name}${this.serializeLabels(labels)}`;
  }

  public incrementCounter(name: string, value = 1, labels?: MetricLabels, help = 'Counter metric'): void {
    if (!this.metadata.has(name)) {
      this.registerMetric(name, 'counter', help);
    }
    const key = this.buildKey(name, labels);
    const current = this.counters.get(key) ?? 0;
    this.counters.set(key, current + value);
  }

  public setGauge(name: string, value: number, labels?: MetricLabels, help = 'Gauge metric'): void {
    if (!this.metadata.has(name)) {
      this.registerMetric(name, 'gauge', help);
    }
    const key = this.buildKey(name, labels);
    this.gauges.set(key, value);
  }

  public recordHistogram(
    name: string,
    valueMs: number,
    labels?: MetricLabels,
    help = 'Histogram latency metric in ms',
  ): void {
    if (!this.metadata.has(name)) {
      this.registerMetric(name, 'histogram', help);
    }
    const key = this.buildKey(name, labels);
    let hist = this.histograms.get(key);
    if (!hist) {
      hist = new HdrHistogram();
      this.histograms.set(key, hist);
    }
    hist.record(valueMs);
  }

  public getHistogram(name: string, labels?: MetricLabels): HdrHistogram | undefined {
    const key = this.buildKey(name, labels);
    return this.histograms.get(key);
  }

  public exportPrometheus(): string {
    const lines: string[] = [];

    // Process system and NodeJS process metrics
    this.collectSystemMetrics();

    for (const [name, meta] of this.metadata.entries()) {
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} ${meta.type}`);

      if (meta.type === 'counter') {
        for (const [key, val] of this.counters.entries()) {
          if (key.startsWith(name)) {
            lines.push(`${key} ${val}`);
          }
        }
      } else if (meta.type === 'gauge') {
        for (const [key, val] of this.gauges.entries()) {
          if (key.startsWith(name)) {
            lines.push(`${key} ${val}`);
          }
        }
      } else if (meta.type === 'histogram') {
        for (const [key, hist] of this.histograms.entries()) {
          if (key.startsWith(name)) {
            // Extract raw label block from key e.g. "my_metric{foo="bar"}"
            const labelMatch = key.match(/{([^}]+)}/);
            const baseLabels = labelMatch ? labelMatch[1] : '';

            for (const b of hist.getBucketCounts()) {
              const bucketLabel = baseLabels
                ? `{${baseLabels},le="${b.le}"}`
                : `{le="${b.le}"}`;
              lines.push(`${name}_bucket${bucketLabel} ${b.count}`);
            }

            const infLabel = baseLabels
              ? `{${baseLabels},le="+Inf"}`
              : `{le="+Inf"}`;
            lines.push(`${name}_bucket${infLabel} ${hist.getCount()}`);

            const sumLabel = baseLabels ? `{${baseLabels}}` : '';
            lines.push(`${name}_sum${sumLabel} ${hist.getSum()}`);
            lines.push(`${name}_count${sumLabel} ${hist.getCount()}`);
          }
        }
      }
      lines.push(''); // Blank line between metrics
    }

    return lines.join('\n') + '\n';
  }

  private collectSystemMetrics(): void {
    const mem = process.memoryUsage();
    this.setGauge('process_resident_memory_bytes', mem.rss, {}, 'Resident memory size in bytes');
    this.setGauge('process_heap_used_bytes', mem.heapUsed, {}, 'Heap memory used in bytes');
    this.setGauge('process_uptime_seconds', Math.floor(process.uptime()), {}, 'Process uptime in seconds');
  }

  public clear(): void {
    this.metadata.clear();
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
  }
}
