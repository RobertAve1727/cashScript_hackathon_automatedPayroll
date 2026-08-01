import { describe, expect, it } from 'vitest';
import { InvariantViolationError, PayrollPeriod } from '../../src/domain/index.js';

const START = new Date('2026-08-01T00:00:00.000Z');
const END = new Date('2026-08-16T00:00:00.000Z');

describe('PayrollPeriod', () => {
  it('requires the end to follow the start', () => {
    expect(() => PayrollPeriod.between(END, START)).toThrow(InvariantViolationError);
    expect(() => PayrollPeriod.between(START, START)).toThrow(/must be after/);
  });

  it('rejects invalid dates', () => {
    expect(() => PayrollPeriod.between(new Date('nonsense'), END)).toThrow(/valid dates/);
  });

  it('is half-open so consecutive periods never double-pay the boundary', () => {
    const first = PayrollPeriod.between(START, END);
    const second = PayrollPeriod.between(END, new Date('2026-09-01T00:00:00.000Z'));

    expect(first.contains(START)).toBe(true);
    expect(first.contains(END)).toBe(false);
    expect(second.contains(END)).toBe(true);
    expect(first.overlaps(second)).toBe(false);
  });

  it('detects overlapping periods', () => {
    const period = PayrollPeriod.between(START, END);
    const overlapping = PayrollPeriod.between(new Date('2026-08-10T00:00:00.000Z'), new Date('2026-08-20T00:00:00.000Z'));

    expect(period.overlaps(overlapping)).toBe(true);
    expect(overlapping.overlaps(period)).toBe(true);
  });

  it('cannot be mutated through the dates it was built from', () => {
    const start = new Date(START);
    const period = PayrollPeriod.between(start, END);

    start.setFullYear(1999);

    expect(period.start.toISOString()).toBe(START.toISOString());
  });

  it('cannot be mutated through the dates it hands out', () => {
    const period = PayrollPeriod.between(START, END);
    period.start.setFullYear(1999);

    expect(period.start.toISOString()).toBe(START.toISOString());
  });

  it('round-trips through a snapshot', () => {
    const period = PayrollPeriod.between(START, END);

    expect(PayrollPeriod.fromSnapshot(period.toSnapshot()).equals(period)).toBe(true);
  });

  it('labels itself by date range', () => {
    expect(PayrollPeriod.between(START, END).label).toBe('2026-08-01..2026-08-16');
  });
});
