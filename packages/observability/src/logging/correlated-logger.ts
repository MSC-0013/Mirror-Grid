import { pino, type Logger, type LoggerOptions } from 'pino';
import { getCurrentTraceContext } from '../tracing/context.js';

export interface CorrelatedLoggerOptions {
  name: string;
  level?: string;
}

export function createCorrelatedLogger(
  options: CorrelatedLoggerOptions,
  destination?: pino.DestinationStream,
): Logger {
  const baseOptions: LoggerOptions = {
    name: options.name,
    level: options.level || process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const ctx = getCurrentTraceContext();
      if (ctx) {
        return {
          trace_id: ctx.traceId,
          span_id: ctx.spanId,
        };
      }
      return {};
    },
  };

  return destination ? pino(baseOptions, destination) : pino(baseOptions);
}
