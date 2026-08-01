import type { CashAddress } from '../../domain/index.js';

export type AddressValidation = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Cryptographic validation of a payout address.
 *
 * `CashAddress` already guarantees the shape (prefix, alphabet, length) with no
 * dependencies. This port covers what the domain deliberately cannot do:
 * verify the BCH checksum and version byte, which needs a crypto library. A
 * mistyped address that still parses will be caught here.
 */
export interface AddressValidator {
  validate(address: CashAddress): AddressValidation;
}
