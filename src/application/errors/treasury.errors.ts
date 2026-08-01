import type { Satoshis } from '../../domain/index.js';
import { ApplicationError } from './application-error.js';

export class InsufficientTreasuryFundsError extends ApplicationError {
  readonly code = 'APP.INSUFFICIENT_TREASURY_FUNDS';

  constructor(
    readonly required: Satoshis,
    readonly available: Satoshis,
  ) {
    super(
      `treasury holds ${available.toBchString()} BCH but the run needs ${required.toBchString()} BCH ` +
        `(short by ${required.minus(available).toBchString()} BCH, before fees)`,
    );
  }
}

/**
 * Thrown by the disbursement gateway adapter when the network refuses the
 * transaction. Declared here, in the application layer, so use cases can catch
 * a failed broadcast without importing anything from infrastructure — the
 * adapter depends on this abstraction, not the other way round.
 */
export class DisbursementFailedError extends ApplicationError {
  readonly code = 'APP.DISBURSEMENT_FAILED';

  constructor(reason: string, options?: ErrorOptions) {
    super(`payroll disbursement failed: ${reason}`, options);
  }
}
