import { MAX_SUPPLY_SATOSHIS, SATOSHIS_PER_BCH } from '../constants.js';
import { InvariantViolationError } from '../errors/invariant-violation.error.js';

const BCH_DECIMALS = 8;
const BCH_PATTERN = /^\d+(\.\d{1,8})?$/;

/**
 * A non-negative amount of satoshis.
 *
 * Money is `bigint` end to end — never `number`. A salary of 0.1 BCH is
 * 10_000_000 satoshis exactly, and floating point has no opportunity to lose a
 * satoshi somewhere between payroll calculation and the transaction output.
 */
export class Satoshis {
  static readonly ZERO = new Satoshis(0n);

  private constructor(readonly value: bigint) {}

  /** Build from a raw satoshi count. */
  static from(value: bigint | number): Satoshis {
    if (typeof value === 'number') {
      if (!Number.isSafeInteger(value)) {
        throw new InvariantViolationError('Satoshis', `"${value}" is not a whole number of satoshis`);
      }
      return Satoshis.from(BigInt(value));
    }

    if (value < 0n) {
      throw new InvariantViolationError('Satoshis', `amount must not be negative, got ${value}`);
    }
    if (value > MAX_SUPPLY_SATOSHIS) {
      throw new InvariantViolationError('Satoshis', `amount ${value} exceeds the total BCH supply`);
    }

    return new Satoshis(value);
  }

  /**
   * Parse a decimal BCH string such as `"0.125"`. Deliberately string-only:
   * accepting a `number` here would reintroduce the float rounding this class
   * exists to prevent.
   */
  static fromBch(amount: string): Satoshis {
    const trimmed = amount.trim();
    if (!BCH_PATTERN.test(trimmed)) {
      throw new InvariantViolationError(
        'Satoshis',
        `"${amount}" is not a valid BCH amount (expected e.g. "1.5", max ${BCH_DECIMALS} decimals)`,
      );
    }

    const [whole = '0', fraction = ''] = trimmed.split('.');
    const paddedFraction = fraction.padEnd(BCH_DECIMALS, '0');

    return Satoshis.from(BigInt(whole) * SATOSHIS_PER_BCH + BigInt(paddedFraction));
  }

  static sum(amounts: readonly Satoshis[]): Satoshis {
    return amounts.reduce<Satoshis>((total, amount) => total.plus(amount), Satoshis.ZERO);
  }

  plus(other: Satoshis): Satoshis {
    return Satoshis.from(this.value + other.value);
  }

  /** @throws InvariantViolationError if the result would be negative. */
  minus(other: Satoshis): Satoshis {
    if (other.value > this.value) {
      throw new InvariantViolationError(
        'Satoshis',
        `cannot subtract ${other.value} from ${this.value} — amounts are never negative`,
      );
    }
    return Satoshis.from(this.value - other.value);
  }

  times(factor: bigint | number): Satoshis {
    return Satoshis.from(this.value * BigInt(factor));
  }

  isZero(): boolean {
    return this.value === 0n;
  }

  isLessThan(other: Satoshis): boolean {
    return this.value < other.value;
  }

  isGreaterThan(other: Satoshis): boolean {
    return this.value > other.value;
  }

  isAtLeast(other: Satoshis): boolean {
    return this.value >= other.value;
  }

  equals(other: Satoshis): boolean {
    return this.value === other.value;
  }

  /** Sort comparator: `amounts.sort(Satoshis.compare)` style usage. */
  compareTo(other: Satoshis): number {
    if (this.value < other.value) return -1;
    if (this.value > other.value) return 1;
    return 0;
  }

  /** Human-readable BCH, trailing zeros trimmed: `"1.5"`, `"0.00000546"`, `"2"`. */
  toBchString(): string {
    const whole = this.value / SATOSHIS_PER_BCH;
    const fraction = (this.value % SATOSHIS_PER_BCH).toString().padStart(BCH_DECIMALS, '0').replace(/0+$/, '');

    return fraction.length > 0 ? `${whole}.${fraction}` : whole.toString();
  }

  toString(): string {
    return this.value.toString();
  }

  /** Persistence-safe representation — `JSON.stringify` cannot encode `bigint`. */
  toJSON(): string {
    return this.value.toString();
  }
}
