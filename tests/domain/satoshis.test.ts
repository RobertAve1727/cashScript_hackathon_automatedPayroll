import { describe, expect, it } from 'vitest';
import { InvariantViolationError, Satoshis } from '../../src/domain/index.js';

describe('Satoshis', () => {
  describe('construction', () => {
    it('accepts whole satoshi amounts', () => {
      expect(Satoshis.from(1_000n).value).toBe(1_000n);
      expect(Satoshis.from(1_000).value).toBe(1_000n);
    });

    it('rejects negative amounts', () => {
      expect(() => Satoshis.from(-1n)).toThrow(InvariantViolationError);
    });

    it('rejects fractional satoshis', () => {
      expect(() => Satoshis.from(1.5)).toThrow(/not a whole number/);
    });

    it('rejects amounts beyond the total supply', () => {
      expect(() => Satoshis.from(2_100_000_000_000_001n)).toThrow(/total BCH supply/);
    });
  });

  describe('fromBch', () => {
    it.each([
      ['1', 100_000_000n],
      ['0.5', 50_000_000n],
      ['0.00000001', 1n],
      ['0.1', 10_000_000n],
      ['21000000', 2_100_000_000_000_000n],
    ])('parses %s BCH exactly', (input, expected) => {
      expect(Satoshis.fromBch(input).value).toBe(expected);
    });

    it('parses 0.1 + 0.2 without float error', () => {
      const total = Satoshis.fromBch('0.1').plus(Satoshis.fromBch('0.2'));

      expect(total.value).toBe(30_000_000n);
      expect(total.toBchString()).toBe('0.3');
    });

    it.each(['', 'abc', '-1', '1.234567891', '1e8', ' 1 . 5 '])('rejects "%s"', (input) => {
      expect(() => Satoshis.fromBch(input)).toThrow(InvariantViolationError);
    });
  });

  describe('arithmetic', () => {
    it('adds, multiplies and sums', () => {
      expect(Satoshis.from(10n).plus(Satoshis.from(5n)).value).toBe(15n);
      expect(Satoshis.from(10n).times(3).value).toBe(30n);
      expect(Satoshis.sum([Satoshis.from(1n), Satoshis.from(2n), Satoshis.from(3n)]).value).toBe(6n);
    });

    it('sums an empty list to zero', () => {
      expect(Satoshis.sum([]).equals(Satoshis.ZERO)).toBe(true);
    });

    it('subtracts within range', () => {
      expect(Satoshis.from(10n).minus(Satoshis.from(4n)).value).toBe(6n);
    });

    it('refuses to subtract into a negative balance', () => {
      expect(() => Satoshis.from(4n).minus(Satoshis.from(10n))).toThrow(/never negative/);
    });
  });

  describe('comparison', () => {
    it('orders amounts', () => {
      const small = Satoshis.from(1n);
      const large = Satoshis.from(2n);

      expect(small.isLessThan(large)).toBe(true);
      expect(large.isGreaterThan(small)).toBe(true);
      expect(large.isAtLeast(large)).toBe(true);
      expect(small.compareTo(large)).toBe(-1);
      expect(large.compareTo(small)).toBe(1);
      expect(small.compareTo(small)).toBe(0);
    });
  });

  describe('formatting', () => {
    it.each([
      [100_000_000n, '1'],
      [150_000_000n, '1.5'],
      [546n, '0.00000546'],
      [0n, '0'],
    ])('renders %s sats as %s BCH', (sats, expected) => {
      expect(Satoshis.from(sats).toBchString()).toBe(expected);
    });

    it('serialises as a string so JSON round-trips exactly', () => {
      expect(JSON.parse(JSON.stringify({ amount: Satoshis.from(2_100_000_000_000_000n) }))).toEqual({
        amount: '2100000000000000',
      });
    });
  });
});
