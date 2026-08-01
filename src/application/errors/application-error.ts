/**
 * Base class for errors raised while orchestrating a use case.
 *
 * Distinct from `DomainError`: a `DomainError` means an aggregate refused an
 * operation, an `ApplicationError` means the *workflow* could not proceed —
 * something was missing, already taken, or the outside world said no.
 */
export abstract class ApplicationError extends Error {
  abstract readonly code: string;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}
