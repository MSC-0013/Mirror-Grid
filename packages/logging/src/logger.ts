import { pino, type Logger, type LoggerOptions } from 'pino';

export interface CreateLoggerOptions {
  name: string;
  level?: string;
  redact?: string[];
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';

  const baseOptions: LoggerOptions = {
    name: options.name,
    level: options.level || process.env.LOG_LEVEL || 'info',
    redact: options.redact || [
      'req.headers.authorization',
      'req.headers.cookie',
      'password',
      'token',
    ],
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label: string) {
        return { level: label };
      },
    },
  };

  if (isDev) {
    return pino({
      ...baseOptions,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          translateTime: 'SYS:standard',
        },
      },
    });
  }

  return pino(baseOptions);
}

export const logger = createLogger({ name: 'mirrorgrid' });
export type { Logger } from 'pino';
