import { InvariantViolationError } from '../errors/invariant-violation.error.js';

export interface PayrollPeriodSnapshot {
  readonly start: string;
  readonly end: string;
}

/**
 * The half-open interval `[start, end)` a payroll run pays for.
 *
 * Half-open so that consecutive periods tile the calendar without a gap and
 * without double-paying the boundary instant.
 *
 * Instants are held as epoch milliseconds internally because `Date` is mutable:
 * a caller who kept a reference to the `Date` they passed in must not be able to
 * reach in and change the period afterwards.
 */
export class PayrollPeriod {
  private constructor(
    private readonly startMs: number,
    private readonly endMs: number,
  ) {}

  static between(start: Date, end: Date): PayrollPeriod {
    const startMs = start.getTime();
    const endMs = end.getTime();

    if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
      throw new InvariantViolationError('PayrollPeriod', 'start and end must both be valid dates');
    }
    if (endMs <= startMs) {
      throw new InvariantViolationError(
        'PayrollPeriod',
        `end (${new Date(endMs).toISOString()}) must be after start (${new Date(startMs).toISOString()})`,
      );
    }

    return new PayrollPeriod(startMs, endMs);
  }

  static fromSnapshot(snapshot: PayrollPeriodSnapshot): PayrollPeriod {
    return PayrollPeriod.between(new Date(snapshot.start), new Date(snapshot.end));
  }

  get start(): Date {
    return new Date(this.startMs);
  }

  get end(): Date {
    return new Date(this.endMs);
  }

  get durationMs(): number {
    return this.endMs - this.startMs;
  }

  /** `"2026-08-01..2026-08-15"` — stable enough to use as a human-facing key. */
  get label(): string {
    return `${this.start.toISOString().slice(0, 10)}..${this.end.toISOString().slice(0, 10)}`;
  }

  contains(instant: Date): boolean {
    const ms = instant.getTime();
    return ms >= this.startMs && ms < this.endMs;
  }

  overlaps(other: PayrollPeriod): boolean {
    return this.startMs < other.endMs && other.startMs < this.endMs;
  }

  equals(other: PayrollPeriod): boolean {
    return this.startMs === other.startMs && this.endMs === other.endMs;
  }

  toString(): string {
    return this.label;
  }

  toSnapshot(): PayrollPeriodSnapshot {
    return { start: this.start.toISOString(), end: this.end.toISOString() };
  }
}
