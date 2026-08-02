/**
 * Splitting a monthly statutory obligation across N pay periods, exactly.
 *
 * ══ WHY THIS FILE EXISTS ════════════════════════════════════════════════
 *
 * SSS, PhilHealth and Pag-IBIG contributions are MONTHLY obligations. The
 * agencies publish brackets, employers remit by the 10th of the following
 * month, and the amount remitted must be the bracket amount — not something
 * near it. Paying more often than monthly is lawful and common (Art. 103 of
 * the Labor Code requires wages at least twice a month), so the monthly figure
 * has to be divided across however many cut-offs the company runs.
 *
 * The naive division is wrong, and wrong in the direction that matters.
 * ₱1,750.00 of SSS across 22 working days is ₱79.5454… a day; truncating to
 * the centavo gives ₱79.54, and 22 × ₱79.54 = ₱1,749.88. The month closes
 * ₱0.12 short. The amount is small; that it is remitted at all is not. What
 * reaches SSS no longer equals the bracket the employee is credited for, and
 * the gap is money already withheld from a worker's payslip — the single
 * failure eSahod exists to make impossible. A daily payroll that divides
 * naively reintroduces it every month, for every employee.
 *
 * ══ THE FIX ═════════════════════════════════════════════════════════════
 *
 * Allocate by RUNNING TOTAL rather than per period:
 *
 *     due(k) = floor(monthly × k / periods) − floor(monthly × (k−1) / periods)
 *
 * Each period pays the difference between the cumulative amount owed through
 * it and the cumulative amount owed through its predecessor. The sum
 * telescopes: every interior term cancels and what is left is
 * floor(monthly × periods / periods) − floor(0) = monthly. Exactly monthly,
 * for any number of periods, with no accumulator to carry and no remainder
 * left over on the last day. The cent that division loses is not lost; it
 * lands on whichever period the running total crosses into.
 *
 * `bigint` division truncates toward zero, matching CashScript's `int`
 * division for the non-negative values used here — the same discipline the
 * rest of the statutory engine follows.
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';

/**
 * The amount due in one period of a monthly obligation.
 *
 * @param monthly    the full monthly obligation, centavos, non-negative
 * @param periods    how many pay periods the month is divided into
 * @param periodIndex which period this is, 1-based and at most `periods`
 */
export function allocateMonthlyAmount(monthly: bigint, periods: number, periodIndex: number): bigint {
  assertSchedule(periods, periodIndex);
  if (monthly < 0n) {
    throw new InvariantViolationError('allocateMonthlyAmount', `monthly must not be negative, got ${monthly}`);
  }

  const n = BigInt(periods)
  const k = BigInt(periodIndex)

  return (monthly * k) / n - (monthly * (k - 1n)) / n;
}

/**
 * Every period's share, in order. Provided so callers can assert the property
 * that matters — `sum(allocateMonthlyAmountAcrossMonth(m, n)) === m` — rather
 * than take it on trust.
 */
export function allocateMonthlyAmountAcrossMonth(monthly: bigint, periods: number): readonly bigint[] {
  const shares: bigint[] = [];
  for (let index = 1; index <= periods; index += 1) {
    shares.push(allocateMonthlyAmount(monthly, periods, index));
  }
  return shares;
}

function assertSchedule(periods: number, periodIndex: number): void {
  if (!Number.isInteger(periods) || periods < 1) {
    throw new InvariantViolationError('allocateMonthlyAmount', `periods must be a positive integer, got ${periods}`);
  }
  if (!Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > periods) {
    throw new InvariantViolationError('allocateMonthlyAmount', `periodIndex must be within 1..${periods}, got ${periodIndex}`,
    );
  }
}
