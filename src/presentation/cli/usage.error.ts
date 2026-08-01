/**
 * The user typed something wrong.
 *
 * Kept distinct from domain and application errors because it deserves a
 * different exit code and a usage hint rather than a stack trace.
 */
export class UsageError extends Error {
  readonly code = 'CLI.USAGE';

  constructor(
    message: string,
    readonly usage?: string,
  ) {
    super(message);
    this.name = 'UsageError';
  }
}
