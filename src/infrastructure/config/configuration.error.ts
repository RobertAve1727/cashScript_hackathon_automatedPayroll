/**
 * Raised when the process is misconfigured — a missing key, an unparseable
 * number, a network name nobody recognises.
 *
 * Deliberately fatal and thrown during composition, before any use case runs:
 * a payroll process that starts with half its configuration is more dangerous
 * than one that refuses to start at all.
 */
export class ConfigurationError extends Error {
  readonly code = 'INFRA.CONFIGURATION';

  constructor(
    readonly variable: string,
    reason: string,
  ) {
    super(`${variable}: ${reason}`);
    this.name = 'ConfigurationError';
  }
}
