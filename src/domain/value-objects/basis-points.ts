import { BASIS_POINTS_SCALE } from '../constants.js';
import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { Satoshis } from './satoshis.js';

/**
 * A rate expressed in basis points (1 bp = 0.01%), used for withholding.
 *
 * Integer basis points rather than a float percentage, so `applyTo` stays exact
 * and always rounds the same way (down, in the employee's favour on deductions).
 */
export class BasisPoints {
  static readonly ZERO = new BasisPoints(0);

  private constructor(readonly value: number) {}

  static of(value: number): BasisPoints {
    if (!Number.isInteger(value)) {
      throw new InvariantViolationError('BasisPoints', `"${value}" must be a whole number of basis points`);
    }
    if (value < 0 || value > BASIS_POINTS_SCALE) {
      throw new InvariantViolationError('BasisPoints', `${value} is outside the range 0..${BASIS_POINTS_SCALE}`);
    }
    return new BasisPoints(value);
  }

  /** Deducted portion of `amount`, rounded down. */
  applyTo(amount: Satoshis): Satoshis {
    return Satoshis.from((amount.value * BigInt(this.value)) / BigInt(BASIS_POINTS_SCALE));
  }

  isZero(): boolean {
    return this.value === 0;
  }

  equals(other: BasisPoints): boolean {
    return this.value === other.value;
  }

  /** `"7.5%"` for 750 basis points. */
  toPercentageString(): string {
    return `${this.value / 100}%`;
  }

  toString(): string {
    return this.value.toString();
  }

  toJSON(): number {
    return this.value;
  }
}
