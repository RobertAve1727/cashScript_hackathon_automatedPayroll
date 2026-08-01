export type LogContext = Readonly<Record<string, unknown>>;

/**
 * Structured logging port.
 *
 * Message plus fields rather than interpolated strings, so an adapter can emit
 * JSON for a log aggregator without the use cases knowing about it.
 */
export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
}
