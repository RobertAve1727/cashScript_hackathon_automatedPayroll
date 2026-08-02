/**
 * Night differential, rest-day and holiday premiums.
 *
 * ══ WHAT THIS REPLACES ══════════════════════════════════════════════════
 *
 * `overtime.ts` computes ordinary-day overtime and says, in its own header,
 * that rest days, holidays and night hours are out of scope because
 * "approximating them would understate what a worker is owed on exactly the
 * days they are owed most". This module is that scope, done properly.
 *
 * ══ THE ONE IDEA ════════════════════════════════════════════════════════
 *
 * Every premium in the Labor Code is a MULTIPLIER on the hourly rate, and they
 * compound rather than add. An overtime hour on a regular holiday is not
 * "200% plus 25%"; it is 30% on top of the holiday rate — 200% × 130% = 260%.
 * A night hour is 10% on top of whatever that hour was already worth.
 *
 * So an hour is described by three independent facts — what kind of day it is,
 * whether it is beyond the eighth hour, and whether it falls between 22:00 and
 * 06:00 — and its value is one product of three factors:
 *
 *     rate = ordinaryHourly × dayFactor × overtimeFactor × nightFactor
 *
 * Everything below is that sentence in integer arithmetic.
 *
 * ══ WHY BASIS POINTS ════════════════════════════════════════════════════
 *
 * The compound cases do not land on whole percentages. A night overtime hour on
 * a regular holiday that is also a rest day is 371.8% of the ordinary rate, and
 * a percentage-valued integer cannot hold that. Basis points can: 37,180.
 *
 * The factors are combined into ONE basis-point figure before any division, so
 * a day's pay truncates once. Composing them as successive divisions would
 * truncate three times and lose centavos — downward, always against the worker.
 *
 * ══ WHAT THE DEPLOYED COVENANT DOES WITH THIS ═══════════════════════════
 *
 * Nothing, and that has to be said plainly. `payroll_treasury.cash` computes
 * `gross = monthlyCompensation / 2` and has no field for premiums — exactly as
 * it has none for overtime. These figures are real entitlements computed by the
 * same engine that produces the payslip, and settling them on chain needs
 * either an HR-signed amendment that folds them into the commitment, or a
 * covenant that reads a premium input. Both are beyond the 40 bytes available.
 *
 * ══ STATUTORY BASIS ═════════════════════════════════════════════════════
 *
 *   Art. 86  RA 442   night shift differential — not less than 10% of the
 *                     regular wage for each hour worked between 10 p.m. and
 *                     6 a.m.
 *   Art. 87  RA 442   overtime — plus at least 25% of the regular wage; plus
 *                     at least 30% on a rest day or holiday
 *   Art. 91-93        rest days and premium pay — plus 30%
 *   Art. 94  RA 442   holiday pay — 100% for an unworked regular holiday,
 *                     200% for the first eight hours worked
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { STANDARD_WORKDAY_SECONDS } from './time-record.js';
import { WORKING_DAYS_PER_MONTH } from '../payroll/schedule.js';

/**
 * What kind of day it is, for pay.
 *
 * `special_working` is listed separately and deliberately. A "special working
 * day" pays the ordinary rate with no premium at all — it is the one
 * proclamation category that looks like a holiday and is not, and treating it
 * as a special NON-working day would overpay by 30%. Naming it is how the trap
 * stops being invisible.
 */
export type DayClassification =
  | 'ordinary'
  | 'rest_day'
  | 'special_non_working'
  | 'special_non_working_rest_day'
  | 'regular_holiday'
  | 'regular_holiday_rest_day'
  | 'double_holiday'
  | 'double_holiday_rest_day'
  | 'double_special_non_working_rest_day'
  | 'special_working'
  | 'special_working_rest_day';

/** One basis point is 1/100 of a percent. 10000 bp is the ordinary rate. */
export const ORDINARY_BP = 10_000n;

/**
 * Pay for the first eight hours, in basis points of the ordinary rate.
 *
 * These are statutory MINIMA. A collective agreement may pay more and none of
 * this stops it; what the law forbids is less.
 */
const DAY_FACTOR_BP: Readonly<Record<DayClassification, bigint>> = {
  ordinary: 10_000n, // 100%
  special_working: 10_000n, // 100% — a working day that merely has a name
  rest_day: 13_000n, // 130% — Art. 93(a)
  special_non_working: 13_000n, // 130% — plus 30%
  // 150%. Two special non-working days proclaimed for one date pay the same
  // 150%, so they share this classification rather than adding a value that
  // would differ only in its name.
  special_non_working_rest_day: 15_000n, // 150% — plus 50%
  regular_holiday: 20_000n, // 200% — Art. 94(b), double pay
  regular_holiday_rest_day: 26_000n, // 260% — 200% plus 30% of it
  // Two regular holidays proclaimed for the same date — Araw ng Kagitingan
  // falling on Maundy Thursday, for instance. It happens, and paying 200% for
  // it is a full day's wage short.
  double_holiday: 30_000n, // 300%
  double_holiday_rest_day: 39_000n, // 390% — 300% plus 30% of it
  // Two special non-working days on a rest day. 195%, and it is NOT 150 x 1.30
  // by coincidence — DOLE prints this cell, and the day factors here are a
  // lookup precisely because they do not compose.
  double_special_non_working_rest_day: 19_500n, // 195%
  // A special WORKING day that lands on the employee's rest day. DOLE's table
  // has no cell for this, and the literal reading — "a special working day is
  // an ordinary day" — pays 100% and quietly drops the 30% the rest day earns
  // under Art. 93(a). A proclamation naming the date does not cancel the rest
  // day, so this pays the rest-day rate. It is the weakest-sourced row in the
  // table and it resolves in the worker's favour, deliberately.
  special_working_rest_day: 13_000n, // 130%
};

/**
 * Overtime, as a factor on the rate ALREADY established for that day.
 *
 * Art. 87 gives +25% on an ordinary day and +30% "on a rest day or holiday".
 * The 30% applies to the hourly rate *on said day*, not to the ordinary rate —
 * which is why these are factors rather than additions.
 */
const OVERTIME_FACTOR_BP: Readonly<Record<DayClassification, bigint>> = {
  ordinary: 12_500n, // +25%
  special_working: 12_500n, // an ordinary day by another name
  rest_day: 13_000n, // +30% of the rest-day rate
  special_non_working: 13_000n,
  special_non_working_rest_day: 13_000n,
  regular_holiday: 13_000n,
  regular_holiday_rest_day: 13_000n,
  double_holiday: 13_000n,
  double_holiday_rest_day: 13_000n,
  double_special_non_working_rest_day: 13_000n,
  special_working_rest_day: 13_000n,
};

/** Art. 86 — +10% of the rate applicable to that hour, whatever it already is. */
export const NIGHT_FACTOR_BP = 11_000n;

/** The night window: 22:00 up to but not including 06:00. */
export const NIGHT_STARTS_HOUR = 22;
export const NIGHT_ENDS_HOUR = 6;

const HOURS_PER_DAY = BigInt(STANDARD_WORKDAY_SECONDS / 3600);
const MINUTES_PER_HOUR = 60n;

/** How an hour is classified for pay. */
export interface HourKind {
  readonly day: DayClassification;
  /** Beyond the eighth hour of the day. */
  readonly overtime: boolean;
  /** Falls between 22:00 and 06:00. */
  readonly night: boolean;
}

/**
 * What one hour is worth, in basis points of the ordinary hourly rate.
 *
 * The three factors multiply. Dividing by ORDINARY_BP twice collapses the two
 * surplus scale factors introduced by multiplying three basis-point figures
 * together, and every intermediate product stays exact: the day factors are
 * multiples of 1000 and the others of 500, so the division never truncates.
 *
 * Worked, to show it terminates where it should: a night overtime hour on a
 * regular holiday that is also a rest day is
 *
 *     26000 × 13000 × 11000 / 10000 / 10000 = 37180  →  371.8%
 */
export function hourFactorBasisPoints(kind: HourKind): bigint {
  const day = DAY_FACTOR_BP[kind.day];

  if (day === undefined) {
    throw new InvariantViolationError('hourFactorBasisPoints', `unknown day classification: ${String(kind.day)}`);
  }

  const overtime = kind.overtime ? OVERTIME_FACTOR_BP[kind.day] : ORDINARY_BP;
  const night = kind.night ? NIGHT_FACTOR_BP : ORDINARY_BP;

  return (day * overtime * night) / ORDINARY_BP / ORDINARY_BP;
}

/**
 * Whether an hour beginning at `hour` (0-23, local) falls in the night window.
 *
 * The window wraps midnight, so this is a disjunction rather than a range —
 * writing it as `hour >= 22 && hour < 6` is the bug that silently pays no night
 * differential at all, because no number satisfies it.
 */
export function isNightHour(hour: number): boolean {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new InvariantViolationError('isNightHour', `hour must be 0..23, got ${hour}`);
  }

  return hour >= NIGHT_STARTS_HOUR || hour < NIGHT_ENDS_HOUR;
}

/**
 * Pay for a number of minutes of one kind, in centavos.
 *
 * ONE division, over the whole expression. The ordinary hourly rate is itself a
 * quotient — monthly basic over 22 days over 8 hours — so computing it first
 * and multiplying afterwards would truncate before the premium was applied and
 * lose up to a centavo per hour, always downward.
 */
export function premiumPay(monthlyBasic: bigint, minutes: number, kind: HourKind): bigint {
  if (!Number.isInteger(minutes)) {
    throw new InvariantViolationError('premiumPay', `minutes must be an integer, got ${minutes}`);
  }
  if (minutes <= 0) return 0n;
  if (monthlyBasic < 0n) {
    throw new InvariantViolationError('premiumPay', `monthlyBasic must not be negative, got ${monthlyBasic}`);
  }

  return (
    (monthlyBasic * BigInt(minutes) * hourFactorBasisPoints(kind)) /
    (BigInt(WORKING_DAYS_PER_MONTH) * HOURS_PER_DAY * MINUTES_PER_HOUR * ORDINARY_BP)
  );
}

/**
 * A stretch of worked time sharing one classification.
 *
 * Payroll consumes segments rather than raw punches because the split points —
 * the eighth hour, 22:00, 06:00 — are decisions about a shift, and a codec that
 * only knows when someone tapped in cannot make them.
 */
export interface WorkSegment extends HourKind {
  readonly minutes: number;
}

/** Total pay for a set of segments, centavos. Each segment truncates once. */
export function segmentsPay(monthlyBasic: bigint, segments: readonly WorkSegment[]): bigint {
  return segments.reduce((total, segment) => total + premiumPay(monthlyBasic, segment.minutes, segment), 0n);
}

/**
 * How many minutes of a worked span fall inside the night window.
 *
 * This is what makes night differential real rather than a checkbox. The punch
 * log already knows when someone arrived and left, so the entitlement can be
 * derived from what happened instead of asked for on a form — and an
 * entitlement nobody has to remember to claim is one nobody can forget to pay.
 *
 * Minute by minute rather than by arithmetic on hour boundaries: a shift can
 * start at 21:47 and cross both ends of the window, and the closed-form version
 * of this has an off-by-one at every boundary. A shift is a few hundred
 * iterations and this runs once per day per employee.
 *
 * Both bounds are unix seconds; `endUnix` before `startUnix` is an open day,
 * not an error, and pays nothing.
 *
 * The offset is a PARAMETER and not a constant lifted from the host clock. Unix
 * seconds are anchored to UTC, so "is this hour after 22:00" is meaningless
 * until a frame is named — and reading it from the machine would make an
 * employee's night differential depend on where the server happens to sit.
 * Philippine Standard Time is UTC+8 and observes no daylight saving, which is
 * why a fixed offset is sufficient here and would not be in most countries.
 */
export const PHT_OFFSET_MINUTES = 8 * 60;

export function nightMinutesIn(
  startUnix: number,
  endUnix: number,
  offsetMinutes: number = PHT_OFFSET_MINUTES,
): number {
  if (!Number.isInteger(startUnix) || !Number.isInteger(endUnix)) {
    throw new InvariantViolationError('nightMinutesIn', 'both bounds must be integer unix seconds');
  }
  if (endUnix <= startUnix) return 0;

  const firstMinute = Math.floor(startUnix / 60) + offsetMinutes;
  const lastMinute = Math.floor((endUnix - 1) / 60) + offsetMinutes;
  let night = 0;

  for (let minute = firstMinute; minute <= lastMinute; minute += 1) {
    // Hour of the local day for this minute. The double modulo keeps it
    // non-negative for timestamps before the epoch and for negative offsets.
    const hourOfDay = Math.floor(((((minute % 1_440) + 1_440) % 1_440)) / 60);
    if (isNightHour(hourOfDay)) night += 1;
  }

  return night;
}

/**
 * Pay for a regular holiday that was NOT worked, in centavos.
 *
 * Art. 94(a): an employee is paid their regular daily wage for an unworked
 * regular holiday. This is the entitlement most often missed, because nothing
 * in an attendance log points at it — there is no punch to trigger it, and a
 * system driven entirely by punches will silently pay nothing.
 *
 * A special non-working day is the opposite: no work, no pay, unless a company
 * policy or agreement says otherwise. Hence zero, and hence the distinction
 * between the two classifications mattering even on a day nobody worked.
 */
export function unworkedDayPay(monthlyBasic: bigint, day: DayClassification): bigint {
  if (day === 'double_holiday' || day === 'double_holiday_rest_day') {
    // Two regular holidays, two days' worth of unworked holiday pay.
    return (monthlyBasic * 2n) / BigInt(WORKING_DAYS_PER_MONTH);
  }

  const paid = day === 'regular_holiday' || day === 'regular_holiday_rest_day';
  if (!paid) return 0n;

  return monthlyBasic / BigInt(WORKING_DAYS_PER_MONTH);
}

/** Every classification, for UIs that offer a choice. */
export const DAY_CLASSIFICATIONS: readonly DayClassification[] = [
  'ordinary',
  'rest_day',
  'special_non_working',
  'special_non_working_rest_day',
  'regular_holiday',
  'regular_holiday_rest_day',
  'double_holiday',
  'double_holiday_rest_day',
  'double_special_non_working_rest_day',
  'special_working',
  'special_working_rest_day',
];

/** Human labels, with the multiplier that makes the choice reviewable. */
export const DAY_LABELS: Readonly<Record<DayClassification, string>> = {
  ordinary: 'Ordinary day',
  rest_day: 'Rest day (+30%)',
  special_non_working: 'Special non-working day (+30%)',
  special_non_working_rest_day: 'Special non-working day on a rest day (+50%)',
  regular_holiday: 'Regular holiday (200%)',
  regular_holiday_rest_day: 'Regular holiday on a rest day (260%)',
  double_holiday: 'Double regular holiday (300%)',
  double_holiday_rest_day: 'Double regular holiday on a rest day (390%)',
  double_special_non_working_rest_day: 'Two special non-working days on a rest day (195%)',
  special_working_rest_day: 'Special working day on a rest day (130%)',
  special_working: 'Special working day (no premium)',
};
