/**
 * Base class for every error the domain layer raises.
 *
 * A `DomainError` always means "a business rule was violated" — never "the
 * database was down" or "the node rejected the transaction". Outer layers can
 * therefore map it safely to a 4xx-style response or a CLI usage error.
 */
export abstract class DomainError extends Error {
  /** Stable, machine-readable identifier. Safe to expose to clients. */
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}
