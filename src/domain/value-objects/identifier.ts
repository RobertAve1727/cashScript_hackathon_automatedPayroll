import { InvariantViolationError } from '../errors/invariant-violation.error.js';

const MAX_IDENTIFIER_LENGTH = 64;

/**
 * Shared behaviour for typed identifiers.
 *
 * Typed ids exist so that `findById(runId)` cannot be called with an employee
 * id: both are strings at runtime, but the compiler rejects the mix-up.
 */
export abstract class Identifier {
  protected constructor(readonly value: string) {}

  /** Two ids are equal only if they are the same *kind* of id and same value. */
  equals(other: Identifier): boolean {
    return this.constructor === other.constructor && this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

export function normaliseIdentifier(kind: string, raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new InvariantViolationError(kind, 'identifier must not be empty');
  }
  if (trimmed.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvariantViolationError(kind, `identifier must be at most ${MAX_IDENTIFIER_LENGTH} characters`);
  }

  return trimmed;
}
