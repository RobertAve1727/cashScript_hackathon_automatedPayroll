import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { BchNetwork } from './bch-network.js';

const PREFIX_TO_NETWORK: Readonly<Record<string, BchNetwork>> = {
  bitcoincash: BchNetwork.Mainnet,
  bchtest: BchNetwork.Testnet,
  bchreg: BchNetwork.Regtest,
};

/** The CashAddr base32 alphabet — note the absence of `1`, `b`, `i` and `o`. */
const PAYLOAD_PATTERN = /^[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{42,112}$/;

/**
 * A payout destination.
 *
 * This performs *structural* validation only — prefix, alphabet, length. It
 * deliberately does not verify the BCH checksum: that needs a cryptographic
 * library, and the domain layer depends on nothing. Checksum verification is an
 * `AddressValidator` port implemented in infrastructure, which use cases call
 * before enrolling an employee.
 *
 * The split is intentional and is the clearest example of the dependency rule
 * in this codebase: the *rule* ("a payout address must be valid and on our
 * network") lives here, the *mechanism* lives outside.
 */
export class CashAddress {
  private constructor(
    readonly value: string,
    readonly network: BchNetwork,
  ) {}

  static parse(raw: string): CashAddress {
    const normalised = raw.trim().toLowerCase();
    const separator = normalised.indexOf(':');

    if (separator <= 0) {
      throw new InvariantViolationError(
        'CashAddress',
        `"${raw}" must include a network prefix, e.g. "bitcoincash:qq..."`,
      );
    }

    const prefix = normalised.slice(0, separator);
    const payload = normalised.slice(separator + 1);
    const network = PREFIX_TO_NETWORK[prefix];

    if (network === undefined) {
      throw new InvariantViolationError(
        'CashAddress',
        `unknown network prefix "${prefix}" (expected one of ${Object.keys(PREFIX_TO_NETWORK).join(', ')})`,
      );
    }
    if (!PAYLOAD_PATTERN.test(payload)) {
      throw new InvariantViolationError('CashAddress', `"${raw}" is not a well-formed CashAddress payload`);
    }

    return new CashAddress(normalised, network);
  }

  belongsTo(network: BchNetwork): boolean {
    return this.network === network;
  }

  equals(other: CashAddress): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}
