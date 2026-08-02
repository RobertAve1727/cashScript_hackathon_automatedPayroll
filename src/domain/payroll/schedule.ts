/**
 * How often a company pays, expressed as data.
 *
 * Article 103 of the Labor Code requires wages "at least once every two weeks
 * or twice a month at intervals not exceeding sixteen days". That is a FLOOR,
 * not a fixed cadence: monthly-only is unlawful, and anything more frequent
 * than semi-monthly is lawful. So the interesting question for a programmable
 * payroll is not "can we pay twice a month" — it is whether the arithmetic
 * still closes exactly when a company chooses to pay every week, or every
 * working day.
 *
 * Each cadence carries the number of pay periods in a month, which is the only
 * thing the statutory engine needs in order to divide a monthly obligation
 * exactly (see `allocateMonthlyAmount`).
 *
 * ── WHAT THE COVENANT SUPPORTS, STATED PLAINLY ──────────────────────────
 *
 * All of them. `contracts/payroll_treasury.cash` takes `periodsPerMonth` as a
 * constructor argument and divides every monthly figure by it, so a treasury
 * deployed with 4 settles a weekly payroll and one deployed with 22 settles a
 * daily one. `tests/infrastructure/esahod/cadence.test.ts` proves both on the
 * real Bitcoin Cash VM.
 *
 * It used to hardcode the semi-monthly divisor — `msc * 5 / 200` and
 * `gross = monthlyCompensation / 2` — and back then `periodSeconds` controlled
 * only WHEN a period became claimable, not how much it paid. Deploying that
 * contract with a daily `periodSeconds` would have paid half a month's salary
 * every day. That is why this flag existed, and why it was false.
 *
 * ── WHAT IS STILL TRUE ──────────────────────────────────────────────────
 *
 * `periodsPerMonth` is a constructor argument, so it is part of the treasury's
 * ADDRESS. One treasury settles one cadence; a company paying some staff weekly
 * and some semi-monthly deploys two treasuries and funds each. That is inherent
 * to how a covenant is addressed, not a gap — and it is why an employee's
 * cadence is an HRIS setting that selects which treasury pays them.
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';

export type PayrollCadence = 'daily' | 'weekly' | 'semi-monthly' | 'monthly';

export interface PayrollSchedule {
  readonly cadence: PayrollCadence;
  /**
   * Pay periods in one month. This is what divides every monthly statutory
   * obligation, so it must be the count the company actually runs.
   */
  readonly periodsPerMonth: number;
  /** Human label for the UI. */
  readonly label: string;
  /**
   * Whether `contracts/payroll_treasury.cash` settles this cadence when a
   * treasury is deployed for it — proven on the real VM in
   * `tests/infrastructure/esahod/cadence.test.ts`.
   *
   * Kept as data rather than assumed, because it was false for two of these
   * until the covenant learned `periodsPerMonth`, and the screens read it
   * rather than asserting anything on their own. `MONTHLY_UNLAWFUL` stays
   * false: the arithmetic would work and Article 103 does not allow it.
   */
  readonly settledByCovenant: boolean;
}

/**
 * Working days per month used by the daily cadence.
 *
 * 22 is the usual figure for a five-day week (261 working days a year ÷ 12).
 * It is a property of the schedule rather than of the calendar month: the
 * statutory division must be stable, because SSS does not accept a different
 * contribution in February.
 */
export const WORKING_DAYS_PER_MONTH = 22;

export const DAILY: PayrollSchedule = {
  cadence: 'daily',
  periodsPerMonth: WORKING_DAYS_PER_MONTH,
  label: 'Daily — every working day',
  settledByCovenant: true,
};

export const WEEKLY: PayrollSchedule = {
  cadence: 'weekly',
  periodsPerMonth: 4,
  label: 'Weekly',
  settledByCovenant: true,
};

export const SEMI_MONTHLY: PayrollSchedule = {
  cadence: 'semi-monthly',
  periodsPerMonth: 2,
  label: 'Semi-monthly — 15th and end of month',
  settledByCovenant: true,
};

/**
 * Present for completeness and deliberately NOT offered as a choice: paying
 * only once a month puts 28–31 days between wage payments, which exceeds the
 * 16-day maximum in Article 103.
 */
export const MONTHLY_UNLAWFUL: PayrollSchedule = {
  cadence: 'monthly',
  periodsPerMonth: 1,
  label: 'Monthly — unlawful under Art. 103 (interval exceeds 16 days)',
  settledByCovenant: false,
};

/** The schedules a company may lawfully choose. */
export const SELECTABLE_SCHEDULES: readonly PayrollSchedule[] = [DAILY, WEEKLY, SEMI_MONTHLY];

/** True when the cadence satisfies Article 103's 16-day maximum interval. */
export function isLawfulCadence(schedule: PayrollSchedule): boolean {
  return schedule.periodsPerMonth >= 2;
}

/**
 * Which period of the month a 1-based running period counter falls in.
 *
 * The employment NFT carries a single monotonic `nextPeriod` counter that only
 * ever increases — it is the anti-double-payment mechanism and knows nothing
 * about months. Statutory allocation, on the other hand, has to restart every
 * month, because the obligation itself is monthly. This maps one to the other.
 */
export function periodOfMonth(runningPeriod: number, schedule: PayrollSchedule): number {
  if (!Number.isInteger(runningPeriod) || runningPeriod < 0) {
    throw new InvariantViolationError('periodOfMonth', `runningPeriod must be a non-negative integer, got ${runningPeriod}`);
  }

  return (runningPeriod % schedule.periodsPerMonth) + 1;
}

/** Every schedule, including the one that may not be chosen. */
const ALL_SCHEDULES: readonly PayrollSchedule[] = [DAILY, WEEKLY, SEMI_MONTHLY, MONTHLY_UNLAWFUL];

/**
 * The schedule a cadence name refers to.
 *
 * Cadence crosses a boundary — it is stored in the HRIS, sent over the wire and
 * read back — so it travels as a string and has to be turned back into a
 * schedule somewhere. Doing that in one place means a value that is not a
 * cadence fails here, with the offending string in the message, rather than
 * three layers later as a division by `undefined`.
 */
export function scheduleFor(cadence: PayrollCadence): PayrollSchedule {
  const found = ALL_SCHEDULES.find((schedule) => schedule.cadence === cadence);

  if (!found) {
    throw new InvariantViolationError('scheduleFor', `unknown pay cadence: ${String(cadence)}`);
  }

  return found;
}

/** True for a string that names a cadence. For parsing what a database returned. */
export function isPayrollCadence(value: unknown): value is PayrollCadence {
  return ALL_SCHEDULES.some((schedule) => schedule.cadence === value);
}

/**
 * A Julian year in seconds — 365.2425 days, the figure the deployed treasury's
 * `periodSeconds` was derived from (31556952 / 24 = 1314873).
 */
export const SECONDS_PER_JULIAN_YEAR = 31_556_952;

/** Pay periods in a year. Twelve months of whatever the schedule runs. */
export function periodsPerYear(schedule: PayrollSchedule): number {
  return schedule.periodsPerMonth * 12;
}

/**
 * How long one pay period lasts, seconds.
 *
 * Derived from `periodsPerMonth` rather than from the calendar, and that is a
 * deliberate choice with a consequence worth stating: a weekly cadence here is
 * 48 periods a year, not 52.
 *
 * The reason is that `periodsPerMonth` is the divisor the statutory engine uses
 * to split a MONTHLY obligation, and the month has to close on the published
 * figure exactly. Fifty-two weeks do not divide twelve months, so a 52-period
 * year would leave every month reconciling against a fraction of a week — the
 * exactness this project is built on would be the first casualty. Four periods
 * a month keeps the allocation exact and puts paydays 7.6 days apart, which is
 * still comfortably inside Article 103's sixteen-day maximum.
 *
 * Truncating integer division: the last period of a year absorbs the remainder,
 * the same way the last period of a month absorbs the indivisible centavo.
 */
export function periodSecondsFor(schedule: PayrollSchedule): bigint {
  return BigInt(SECONDS_PER_JULIAN_YEAR) / BigInt(periodsPerYear(schedule));
}

/**
 * When a period becomes claimable, as a unix timestamp in seconds.
 *
 * This is the app-side twin of the covenant's only temporal rule —
 * `require(tx.time >= genesisTime + period * periodSeconds)` at
 * `contracts/payroll_treasury.cash:217` — and of `payableAt` in the payroll
 * daemon. Having it in the domain is what lets a screen answer "is this
 * employee due" with the same arithmetic that decides whether the transaction
 * will actually be accepted, instead of a second opinion that can drift.
 */
export function payableAt(
  genesisTime: bigint,
  period: number,
  schedule: PayrollSchedule,
): bigint {
  if (!Number.isInteger(period) || period < 0) {
    throw new InvariantViolationError('payableAt', `period must be a non-negative integer, got ${period}`);
  }

  return genesisTime + BigInt(period) * periodSecondsFor(schedule);
}

/** Whether `period` may be claimed at `now`. Both in unix seconds. */
export function isPayableNow(
  genesisTime: bigint,
  period: number,
  schedule: PayrollSchedule,
  now: bigint,
): boolean {
  return now >= payableAt(genesisTime, period, schedule);
}

/**
 * What a contract window measured in periods becomes under a different cadence.
 *
 * `endPeriod` is two bytes of the employment commitment counting PERIODS, not
 * time — so it means something different the moment the cadence changes. A
 * one-year contract is `endPeriod = 24` semi-monthly and `endPeriod = 264`
 * daily, and a record moved to a faster cadence without rescaling stops paying
 * early: the covenant simply fails `require(period <= endPeriod)` and the
 * employee is unpaid with no explanation attached to the failure.
 *
 * Rounding is toward the employee. A window that cannot be expressed exactly in
 * the new cadence is rounded UP, because the alternative is silently shortening
 * someone's employment contract to make an integer divide evenly.
 */
export function rescaleEndPeriod(
  endPeriod: number,
  from: PayrollSchedule,
  to: PayrollSchedule,
): number {
  if (!Number.isInteger(endPeriod) || endPeriod < 0) {
    throw new InvariantViolationError('rescaleEndPeriod', `endPeriod must be a non-negative integer, got ${endPeriod}`);
  }

  const scaled = (endPeriod * to.periodsPerMonth) / from.periodsPerMonth;

  return Math.ceil(scaled);
}

/**
 * What `taxPerPeriod` becomes under a different cadence.
 *
 * The commitment's `taxPerPeriod` is denominated in whatever period the record
 * was written for. Change the cadence without rewriting it and the covenant
 * keeps sending that same figure every period — twenty-two times a month at
 * daily cadence instead of twice, so ELEVEN times the month's withholding tax
 * reaches the BIR, drawn from the employee's pay.
 *
 * Deliberately NOT applied automatically anywhere. Rewriting the commitment is
 * an HR-signed amendment on chain, and this function exists so a screen can
 * show what the amendment would have to say before anyone signs it.
 */
export function rescaleTaxPerPeriod(
  taxPerPeriod: bigint,
  from: PayrollSchedule,
  to: PayrollSchedule,
): bigint {
  const monthly = taxPerPeriod * BigInt(from.periodsPerMonth);

  return monthly / BigInt(to.periodsPerMonth);
}
