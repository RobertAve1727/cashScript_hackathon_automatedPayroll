import { DomainError } from './domain-error.js';

/**
 * Raised when a value object or entity is asked to enter a state that its own
 * rules forbid — a negative amount, an empty name, a malformed address.
 */
export class InvariantViolationError extends DomainError {
  readonly code = 'DOMAIN.INVARIANT_VIOLATION';

  constructor(
    /** The type whose invariant was violated, e.g. `Satoshis`. */
    readonly subject: string,
    reason: string,
  ) {
    super(`${subject}: ${reason}`);
  }
}
