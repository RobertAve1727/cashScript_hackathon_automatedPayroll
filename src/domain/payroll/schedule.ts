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
 * ── WHAT THE DEPLOYED COVENANT SUPPORTS, STATED PLAINLY ─────────────────
 *
 * `contracts/payroll_treasury.cash` hardcodes the semi-monthly divisor: it
 * computes `msc * 5 / 200` and `gross = monthlyCompensation / 2`. Its
 * `periodSeconds` constructor parameter controls only WHEN a period becomes
 * claimable, not how much it pays — deploying it with `periodSeconds = 86400`
 * would pay half a month's salary every day, which is a bug and not a feature.
 *
 * Changing cadence on chain therefore means changing two constants in the
 * covenant and redeploying, not flipping a flag. This module is the engine
 * that already computes any cadence correctly and the schedules the UI offers;
 * `SEMI_MONTHLY` is the one the currently deployed covenant settles.
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
   * Whether `contracts/payroll_treasury.cash` as currently compiled settles
   * this cadence. Exactly one schedule is `true`; the rest are engine-ready
   * and need a covenant redeploy. Kept as data so no screen can claim
   * on-chain support the contract does not have.
   */
  readonly settledByDeployedCovenant: boolean;
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
  settledByDeployedCovenant: false,
};

export const WEEKLY: PayrollSchedule = {
  cadence: 'weekly',
  periodsPerMonth: 4,
  label: 'Weekly',
  settledByDeployedCovenant: false,
};

export const SEMI_MONTHLY: PayrollSchedule = {
  cadence: 'semi-monthly',
  periodsPerMonth: 2,
  label: 'Semi-monthly — 15th and end of month',
  settledByDeployedCovenant: true,
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
  settledByDeployedCovenant: false,
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
