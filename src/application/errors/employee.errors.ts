import type { BchNetwork } from '../../domain/index.js';
import { ApplicationError } from './application-error.js';

export class EmployeeNotFoundError extends ApplicationError {
  readonly code = 'APP.EMPLOYEE_NOT_FOUND';

  constructor(readonly employeeId: string) {
    super(`no employee with id "${employeeId}"`);
  }
}

/**
 * Two employees sharing a payout address would make the on-chain record
 * ambiguous and a mistyped address impossible to spot, so it is refused.
 */
export class DuplicatePayoutAddressError extends ApplicationError {
  readonly code = 'APP.DUPLICATE_PAYOUT_ADDRESS';

  constructor(
    readonly address: string,
    readonly existingEmployeeId: string,
  ) {
    super(`payout address ${address} is already used by employee "${existingEmployeeId}"`);
  }
}

/** The address is well-formed but fails checksum or version-byte validation. */
export class InvalidPayoutAddressError extends ApplicationError {
  readonly code = 'APP.INVALID_PAYOUT_ADDRESS';

  constructor(
    readonly address: string,
    readonly reason: string,
  ) {
    super(`payout address ${address} is not valid: ${reason}`);
  }
}

/** Paying a testnet address from a mainnet treasury burns the money. */
export class PayoutAddressNetworkMismatchError extends ApplicationError {
  readonly code = 'APP.PAYOUT_ADDRESS_NETWORK_MISMATCH';

  constructor(
    readonly address: string,
    readonly addressNetwork: BchNetwork,
    readonly treasuryNetwork: BchNetwork,
  ) {
    super(
      `payout address ${address} is a ${addressNetwork} address but the treasury runs on ${treasuryNetwork}`,
    );
  }
}
