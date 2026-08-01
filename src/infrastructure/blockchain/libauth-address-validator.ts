import { decodeCashAddress } from '@bitauth/libauth';
import type { AddressValidation, AddressValidator } from '../../application/index.js';
import type { CashAddress } from '../../domain/index.js';

/**
 * Checksum and version-byte validation, backed by libauth.
 *
 * This is the other half of `CashAddress`: the domain guarantees the shape
 * without a single dependency, this adapter proves the address is real. A
 * transposed character passes the first check and fails this one — which is the
 * entire point, because BCH payments to a wrong-but-valid address are final.
 */
export class LibauthAddressValidator implements AddressValidator {
  validate(address: CashAddress): AddressValidation {
    const decoded = decodeCashAddress(address.value);

    // libauth signals failure by returning the error message as a string.
    if (typeof decoded === 'string') {
      return { ok: false, reason: decoded };
    }

    return { ok: true };
  }
}
