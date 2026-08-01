import type { LogContext, Logger } from '../../application/index.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

const LEVEL_RANK: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

export interface ConsoleLoggerOptions {
  readonly level?: LogLevel;
  /** Where lines are written. Defaults to stderr. */
  readonly sink?: (line: string) => void;
}

/**
 * Structured logger writing one JSON object per line.
 *
 * Logs go to **stderr** so that stdout stays a clean, pipeable data channel —
 * `payroll employee:list --json | jq` must not have log lines mixed into it.
 */
export class ConsoleLogger implements Logger {
  private readonly threshold: number;
  private readonly write: (line: string) => void;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.threshold = LEVEL_RANK[options.level ?? 'info'];
    this.write = options.sink ?? ((line) => process.stderr.write(`${line}\n`));
  }

  info(message: string, context?: LogContext): void {
    this.emit('info', message, context);
  }

  warn(message: string, context?: LogContext): void {
    this.emit('warn', message, context);
  }

  error(message: string, context?: LogContext): void {
    this.emit('error', message, context);
  }

  private emit(level: Exclude<LogLevel, 'silent'>, message: string, context?: LogContext): void {
    if (LEVEL_RANK[level] < this.threshold) return;

    this.write(
      JSON.stringify({
        level,
        time: new Date().toISOString(),
        message,
        ...context,
      }),
    );
  }
}
