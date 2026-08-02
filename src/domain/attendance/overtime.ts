/**
 * Overtime, and the approval that has to precede it.
 *
 * ══ THE RULE THIS FILE EXISTS TO ENFORCE ════════════════════════════════
 *
 * Hours worked beyond the standard day earn nothing until somebody with the
 * authority to approve them has done so. Not "are flagged for review" — earn
 * NOTHING. An employee who stays late without an approved request is owed the
 * same as one who went home, and `approvedOvertimeMinutes` is the only door
 * overtime can reach payroll through.
 *
 * That is deliberately strict, and it is the employer's side of a real
 * tension: uncontrolled overtime is a cost nobody authorised, and paying it
 * automatically removes the employer's ability to manage it. The counterweight
 * is that a REFUSAL is as recorded as an approval — a request that was filed
 * and rejected leaves a trail, so "we never approved it" and "we never saw it"
 * stop being the same sentence.
 *
 * ══ THE ARITHMETIC ══════════════════════════════════════════════════════
 *
 * Article 87 of the Labor Code: work beyond eight hours is paid the regular
 * wage **plus at least 25%**. So an overtime hour is 125% of an ordinary one.
 *
 *     hourly   = monthlyBasic / (workingDays × hoursPerDay)
 *     overtime = hourly × 125% × hours
 *
 * Written as ONE division so it truncates once, the same discipline the
 * statutory engine follows — nested divisions drift by a centavo and a centavo
 * of drift makes a transaction unspendable.
 *
 * Minutes rather than fractional hours, for the same reason there are no
 * floats anywhere else in this project: 1.5 hours is exact, 1.1 is not.
 *
 * ══ WHAT IS NOT MODELLED, AND SHOULD NOT BE FAKED ═══════════════════════
 *
 * Rest-day and holiday overtime (Art. 93) carry different premiums that
 * compound with this one — 130% for a rest day, 200% for a regular holiday,
 * and overtime on top of those multiplies again. Night-shift differential
 * (Art. 86) adds 10% for hours between 22:00 and 06:00 and stacks with
 * overtime. Each is a real entitlement, each needs the calendar and the shift
 * schedule this module does not have, and approximating them would understate
 * what a worker is owed on exactly the days they are owed most.
 *
 * Ordinary-day overtime only. Everything else is out of scope and named here
 * so nobody mistakes silence for coverage.
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { STANDARD_WORKDAY_SECONDS } from './time-record.js';
import { WORKING_DAYS_PER_MONTH } from '../payroll/schedule.js';

/** Art. 87 — the regular wage plus 25%. */
export const OVERTIME_PREMIUM_PERCENT = 125n;

export const MINUTES_PER_HOUR = 60n;
const HOURS_PER_DAY = BigInt(STANDARD_WORKDAY_SECONDS / 3600);

/**
 * A cap on a single day's request. Art. 83 sets the normal day at eight hours;
 * a request beyond another full day is far likelier to be a typo than a shift,
 * and a typo that reaches payroll is expensive to unwind.
 */
export const MAX_OVERTIME_MINUTES_PER_DAY = 8 * 60;

export type OvertimeStatus = 'pending' | 'approved' | 'rejected';

export interface OvertimeRequest {
  readonly id: string;
  readonly employeeNo: number;
  /** Calendar day the overtime was worked, `YYYY-MM-DD`. */
  readonly workDate: string;
  readonly minutes: number;
  readonly reason: string;
  readonly status: OvertimeStatus;
  /** Unix seconds. */
  readonly filedAt: number;
  readonly decidedAt?: number;
  /** Who approved or rejected it — an audit trail, not an authorisation check. */
  readonly decidedBy?: string;
}

export function assertRequestable(minutes: number): void {
  if (!Number.isInteger(minutes) || minutes <= 0) {
    throw new InvariantViolationError(
      'OvertimeRequest',
      `minutes must be a positive whole number, got ${minutes}`,
    );
  }
  if (minutes > MAX_OVERTIME_MINUTES_PER_DAY) {
    throw new InvariantViolationError(
      'OvertimeRequest',
      `a single day cannot claim more than ${MAX_OVERTIME_MINUTES_PER_DAY} minutes of overtime, got ${minutes}`,
    );
  }
}

/**
 * Minutes that actually count toward pay.
 *
 * The filter is `status === 'approved'` and nothing else. Pending is not
 * "probably fine", and rejected is not "worth half" — both are zero.
 */
export function approvedOvertimeMinutes(
  requests: readonly OvertimeRequest[],
  filter: { employeeNo?: number; workDate?: string } = {},
): number {
  return requests
    .filter((request) => request.status === 'approved')
    .filter((request) => filter.employeeNo === undefined || request.employeeNo === filter.employeeNo)
    .filter((request) => filter.workDate === undefined || request.workDate === filter.workDate)
    .reduce((total, request) => total + request.minutes, 0);
}

/**
 * The ordinary hourly rate, centavos. Exposed for payslips, which have to
 * show the rate the premium was computed from or the figure is unreviewable.
 */
export function hourlyRate(monthlyBasic: bigint): bigint {
  return monthlyBasic / (BigInt(WORKING_DAYS_PER_MONTH) * HOURS_PER_DAY);
}

/**
 * Pay for a number of approved overtime minutes, centavos.
 *
 * One division, so the truncation happens once. Expanding this into
 * `hourlyRate() * premium / 100` would truncate twice and drift.
 */
export function overtimePay(monthlyBasic: bigint, minutes: number): bigint {
  if (minutes <= 0) return 0n;

  return (
    (monthlyBasic * BigInt(minutes) * OVERTIME_PREMIUM_PERCENT) /
    (BigInt(WORKING_DAYS_PER_MONTH) * HOURS_PER_DAY * MINUTES_PER_HOUR * 100n)
  );
}

/**
 * What the approved overtime in a set of requests is worth.
 *
 * The entry point payroll should use: it cannot be handed unapproved hours,
 * because it never sees them.
 */
export function approvedOvertimePay(
  monthlyBasic: bigint,
  requests: readonly OvertimeRequest[],
  filter: { employeeNo?: number; workDate?: string } = {},
): bigint {
  return overtimePay(monthlyBasic, approvedOvertimeMinutes(requests, filter));
}

/** Apply a decision, preserving the original request for the audit trail. */
export function decide(
  request: OvertimeRequest,
  status: Extract<OvertimeStatus, 'approved' | 'rejected'>,
  decidedBy: string,
  decidedAt: number,
): OvertimeRequest {
  if (request.status !== 'pending') {
    throw new InvariantViolationError(
      'OvertimeRequest',
      `#${request.employeeNo} on ${request.workDate} was already ${request.status}; a decision is final`,
    );
  }

  return { ...request, status, decidedBy, decidedAt };
}
