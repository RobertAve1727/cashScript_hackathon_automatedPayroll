/**
 * The statutory engine for ANY pay cadence, with the month closing exactly.
 *
 * ══ HOW THIS RELATES TO `computeDeductions` ═════════════════════════════
 *
 * `deductions.ts` mirrors the deployed covenant character for character. It is
 * period-INVARIANT by necessity: `payroll_treasury.cash` recomputes the same
 * figures from the commitment on every run and has no idea which cut-off of
 * the month it is settling. That file must not change — the covenant's 284
 * opcodes are proven against it.
 *
 * This file is the engine one layer up. It takes the same employment record
 * plus a `PayrollSchedule` and answers a different question: what is due in
 * THIS period, such that the periods of a month sum to exactly the published
 * monthly bracket? That is the question a daily or weekly payroll has to
 * answer and a period-invariant calculation cannot.
 *
 * ══ THE ONE-CENTAVO FINDING, STATED OUT LOUD ════════════════════════════
 *
 * Because the covenant pays an identical amount every cut-off, a monthly
 * obligation that is an odd number of centavos cannot be split evenly: two
 * cut-offs of `floor(monthly / 2)` sum to `monthly − 1`. SSS never exhibits
 * this (its MSC is always a multiple of ₱500, so the monthly share is always
 * even), but PhilHealth is 2.5% of an arbitrary basic salary and does — a
 * basic of ₱10,000.40 gives a monthly employee premium of ₱250.01 and two
 * cut-offs of ₱125.00, one centavo short.
 *
 * The scheduled engine does not have that defect at any cadence, because the
 * running-total allocation puts the odd centavo on a real period instead of
 * dropping it. `scheduled-deductions.test.ts` pins both behaviours side by
 * side rather than quietly papering over the difference.
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import type { PayrollSchedule } from '../payroll/schedule.js';
import { allocateMonthlyAmount } from './allocation.js';
import { monthlySalaryCredit } from './deductions.js';
import {
  HDMF_LOW_RATE_THRESHOLD,
  HDMF_MAXIMUM_FUND_SALARY,
  HDMF_RATE_EMPLOYEE_HIGH_PERCENT,
  HDMF_RATE_EMPLOYEE_LOW_PERCENT,
  HDMF_RATE_EMPLOYER_PERCENT,
  PHIC_INCOME_CEILING,
  PHIC_INCOME_FLOOR,
  PHIC_RATE_TOTAL_PERMILLE,
  SSS_EC_MONTHLY_HIGH,
  SSS_EC_MONTHLY_LOW,
  SSS_EC_THRESHOLD_MSC,
  SSS_RATE_EMPLOYEE_PERCENT,
  SSS_RATE_EMPLOYER_PERCENT,
} from './rates.js';

export interface ScheduledDeductionInput {
  readonly monthlyBasic: bigint;
  readonly monthlyAllowance: bigint;
  /** Withholding tax for the whole MONTH, computed by HR. Allocated like the rest. */
  readonly monthlyTax: bigint;
  readonly schedule: PayrollSchedule;
  /** Which period of the month this is, 1-based. See `periodOfMonth`. */
  readonly periodOfMonth: number;
  /**
   * Periods actually worked, for cadences where pay follows attendance.
   * `1` means a full period. `0` means the employee was absent and earns no
   * wage — but see `MONTHLY OBLIGATIONS DO NOT PRORATE` below.
   */
  readonly periodsWorked?: number;
}

/** The monthly obligations, before they are split across periods. */
export interface MonthlyObligations {
  readonly monthlyCompensation: bigint;
  readonly sssMsc: bigint;
  readonly sssEE: bigint;
  readonly sssER: bigint;
  readonly sssEC: bigint;
  readonly phicEE: bigint;
  readonly phicER: bigint;
  readonly hdmfEE: bigint;
  readonly hdmfER: bigint;
}

export interface ScheduledDeductions {
  readonly schedule: PayrollSchedule;
  readonly periodOfMonth: number;
  /** What the whole month owes — the figures the agencies publish. */
  readonly monthly: MonthlyObligations;

  readonly gross: bigint;
  readonly sssEE: bigint;
  readonly sssER: bigint;
  readonly sssEC: bigint;
  readonly sssTotal: bigint;
  readonly phicEE: bigint;
  readonly phicER: bigint;
  readonly phicTotal: bigint;
  readonly hdmfEE: bigint;
  readonly hdmfER: bigint;
  readonly hdmfTotal: bigint;
  readonly tax: bigint;
  readonly net: bigint;
  readonly totalDrawn: bigint;
}

/**
 * The monthly figures every cadence divides. Identical to what
 * `computeDeductions` computes for a month, expressed once so the two engines
 * cannot drift apart on the brackets themselves — only on how they split them.
 */
export function monthlyObligations(monthlyBasic: bigint, monthlyAllowance: bigint): MonthlyObligations {
  const monthlyCompensation = monthlyBasic + monthlyAllowance;

  const sssMsc = monthlySalaryCredit(monthlyCompensation);
  const sssEE = (sssMsc * SSS_RATE_EMPLOYEE_PERCENT) / 100n;
  const sssER = (sssMsc * SSS_RATE_EMPLOYER_PERCENT) / 100n;
  const sssEC = sssMsc >= SSS_EC_THRESHOLD_MSC ? SSS_EC_MONTHLY_HIGH : SSS_EC_MONTHLY_LOW;

  let phicBase = monthlyBasic;
  if (phicBase < PHIC_INCOME_FLOOR) phicBase = PHIC_INCOME_FLOOR;
  if (phicBase > PHIC_INCOME_CEILING) phicBase = PHIC_INCOME_CEILING;
  // 5‰ total premium, halved into the employee's share: rate/1000 × 1/2.
  const phicEE = (phicBase * PHIC_RATE_TOTAL_PERMILLE) / 2_000n;
  const phicER = phicEE;

  let hdmfBase = monthlyCompensation;
  if (hdmfBase > HDMF_MAXIMUM_FUND_SALARY) hdmfBase = HDMF_MAXIMUM_FUND_SALARY;
  const hdmfEmployeeRate =
    monthlyCompensation <= HDMF_LOW_RATE_THRESHOLD
      ? HDMF_RATE_EMPLOYEE_LOW_PERCENT
      : HDMF_RATE_EMPLOYEE_HIGH_PERCENT;
  const hdmfEE = (hdmfBase * hdmfEmployeeRate) / 100n;
  const hdmfER = (hdmfBase * HDMF_RATE_EMPLOYER_PERCENT) / 100n;

  return { monthlyCompensation, sssMsc, sssEE, sssER, sssEC, phicEE, phicER, hdmfEE, hdmfER };
}

/**
 * What is due in one period of one month, at any cadence.
 *
 * ── MONTHLY OBLIGATIONS DO NOT PRORATE ──────────────────────────────────
 *
 * `periodsWorked` scales the WAGE, because an employee who did not work a day
 * does not earn that day. It deliberately does NOT scale the contributions:
 * SSS, PhilHealth and Pag-IBIG are owed on the monthly salary credit for the
 * month, not per day attended, and an employer who remits less because someone
 * took leave is under-remitting. Conflating the two is a common payroll bug
 * and the reason the wage and the obligations are allocated separately here.
 */
export function computeScheduledDeductions(input: ScheduledDeductionInput): ScheduledDeductions {
  const { monthlyBasic, monthlyAllowance, monthlyTax, schedule, periodOfMonth } = input;
  const periodsWorked = input.periodsWorked ?? 1;

  if (periodsWorked < 0 || periodsWorked > 1) {
    throw new InvariantViolationError('computeScheduledDeductions', `periodsWorked is a fraction of one period, 0..1, got ${periodsWorked}`,
    );
  }

  const monthly = monthlyObligations(monthlyBasic, monthlyAllowance);
  const at = (amount: bigint): bigint =>
    allocateMonthlyAmount(amount, schedule.periodsPerMonth, periodOfMonth);

  // The wage for a full period, then reduced by whatever fraction was not
  // worked. Scaling with integer arithmetic on centavos keeps the result exact
  // for whole periods, which is the only case the covenant path ever sees.
  const fullGross = at(monthly.monthlyCompensation);
  const gross =
    periodsWorked === 1
      ? fullGross
      : (fullGross * BigInt(Math.round(periodsWorked * 10_000))) / 10_000n;

  const sssEE = at(monthly.sssEE);
  const sssER = at(monthly.sssER);
  const sssEC = at(monthly.sssEC);
  const sssTotal = sssEE + sssER + sssEC;

  const phicEE = at(monthly.phicEE);
  const phicER = at(monthly.phicER);
  const phicTotal = phicEE + phicER;

  const hdmfEE = at(monthly.hdmfEE);
  const hdmfER = at(monthly.hdmfER);
  const hdmfTotal = hdmfEE + hdmfER;

  const tax = at(monthlyTax);
  const net = gross - sssEE - phicEE - hdmfEE - tax;
  const totalDrawn = net + sssTotal + phicTotal + hdmfTotal + tax;

  return {
    schedule,
    periodOfMonth,
    monthly,
    gross,
    sssEE,
    sssER,
    sssEC,
    sssTotal,
    phicEE,
    phicER,
    phicTotal,
    hdmfEE,
    hdmfER,
    hdmfTotal,
    tax,
    net,
    totalDrawn,
  };
}

/**
 * Every period of one month, in order. The reconciliation the tests assert
 * against — and the table the HR screen shows before a company commits to a
 * cadence.
 */
export function scheduleMonth(
  input: Omit<ScheduledDeductionInput, 'periodOfMonth' | 'periodsWorked'>,
): readonly ScheduledDeductions[] {
  const periods: ScheduledDeductions[] = [];
  for (let index = 1; index <= input.schedule.periodsPerMonth; index += 1) {
    periods.push(computeScheduledDeductions({ ...input, periodOfMonth: index }));
  }
  return periods;
}
