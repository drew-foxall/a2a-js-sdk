/**
 * Pluggable Logger Interface for A2A Server
 *
 * Provides a minimal logging abstraction that works across all runtimes.
 * Users can implement this interface to integrate with their preferred logging solution.
 */

/**
 * Log levels supported by the A2A logger.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Structured log context for additional metadata.
 */
/**
 * Error details in log context.
 */
export interface LogContextError {
  name: string;
  message: string;
  stack?: string;
  code?: number;
}

export interface LogContext {
  /** Request ID for tracing */
  requestId?: string;
  /** Task ID being processed */
  taskId?: string;
  /** HTTP method */
  method?: string;
  /** Request path */
  path?: string;
  /** HTTP status code */
  statusCode?: number;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error details */
  error?: LogContextError;
  /** Additional custom fields */
  [key: string]: unknown;
}

/**
 * Type guard for LogContextError.
 */
function isLogContextError(value: unknown): value is LogContextError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'name' in value &&
    'message' in value &&
    typeof (value as LogContextError).name === 'string' &&
    typeof (value as LogContextError).message === 'string'
  );
}

/**
 * Logger interface for A2A server.
 *
 * Implementations should be stateless and safe for concurrent use.
 * All methods are synchronous to avoid adding async overhead to hot paths.
 *
 * @example
 * ```ts
 * // Console logger (default)
 * const logger = ConsoleLogger.create();
 *
 * // Custom structured logger
 * const logger: Logger = {
 *   debug: (msg, ctx) => myLogger.debug({ ...ctx, message: msg }),
 *   info: (msg, ctx) => myLogger.info({ ...ctx, message: msg }),
 *   warn: (msg, ctx) => myLogger.warn({ ...ctx, message: msg }),
 *   error: (msg, ctx) => myLogger.error({ ...ctx, message: msg }),
 * };
 * ```
 */
export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}

/**
 * No-op logger that discards all log messages.
 * Useful for testing or when logging is not needed.
 */
export const NoopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Console-based logger implementation.
 * Formats log messages with timestamp, level, and optional context.
 */
export class ConsoleLogger implements Logger {
  private readonly minLevel: LogLevel;
  private static readonly LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  /**
   * Creates a new ConsoleLogger instance.
   */
  static create(minLevel: LogLevel = 'info'): Logger {
    return new ConsoleLogger(minLevel);
  }

  private shouldLog(level: LogLevel): boolean {
    return ConsoleLogger.LEVELS[level] >= ConsoleLogger.LEVELS[this.minLevel];
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    if (!context || Object.keys(context).length === 0) {
      return `${prefix} ${message}`;
    }

    // Format context as key=value pairs for readability
    const contextStr = Object.entries(context)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => {
        if (k === 'error' && isLogContextError(v)) {
          return `error="${v.message}"`;
        }
        return `${k}=${JSON.stringify(v)}`;
      })
      .join(' ');

    return `${prefix} ${message} ${contextStr}`;
  }

  debug(message: string, context?: LogContext): void {
    if (this.shouldLog('debug')) {
      console.debug(this.formatMessage('debug', message, context));
    }
  }

  info(message: string, context?: LogContext): void {
    if (this.shouldLog('info')) {
      console.info(this.formatMessage('info', message, context));
    }
  }

  warn(message: string, context?: LogContext): void {
    if (this.shouldLog('warn')) {
      console.warn(this.formatMessage('warn', message, context));
    }
  }

  error(message: string, context?: LogContext): void {
    if (this.shouldLog('error')) {
      console.error(this.formatMessage('error', message, context));
    }
  }
}

/**
 * JSON-structured logger for production environments.
 * Outputs newline-delimited JSON for easy parsing by log aggregators.
 */
export class JsonLogger implements Logger {
  private readonly minLevel: LogLevel;
  private static readonly LEVELS: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  static create(minLevel: LogLevel = 'info'): Logger {
    return new JsonLogger(minLevel);
  }

  private shouldLog(level: LogLevel): boolean {
    return JsonLogger.LEVELS[level] >= JsonLogger.LEVELS[this.minLevel];
  }

  private log(level: LogLevel, message: string, context?: LogContext): void {
    if (!this.shouldLog(level)) return;

    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...context,
    };

    // Use appropriate console method for log level
    const output = JSON.stringify(entry);
    switch (level) {
      case 'debug':
        console.debug(output);
        break;
      case 'info':
        console.info(output);
        break;
      case 'warn':
        console.warn(output);
        break;
      case 'error':
        console.error(output);
        break;
    }
  }

  debug(message: string, context?: LogContext): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: LogContext): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.log('error', message, context);
  }
}
