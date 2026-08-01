import { DomainError } from './domain-error.js';

/**
 * Raised when an aggregate is asked to make a transition its lifecycle forbids,
 * e.g. settling a payroll run that was never approved.
 */
export class IllegalStateTransitionError extends DomainError {
  readonly code = 'DOMAIN.ILLEGAL_STATE_TRANSITION';

  constructor(
    readonly aggregate: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${aggregate} cannot transition from "${from}" to "${to}"`);
  }
}
