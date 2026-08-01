import type { PayrollRunStatus } from '../../domain/index.js';
import { ApplicationError } from './application-error.js';

export class PayrollRunNotFoundError extends ApplicationError {
  readonly code = 'APP.PAYROLL_RUN_NOT_FOUND';

  constructor(readonly runId: string) {
    super(`no payroll run with id "${runId}"`);
  }
}

/**
 * Guards the "never pay a period twice" rule at the workflow level: the domain
 * stops one *run* being settled twice, this stops two runs covering the same
 * days from existing at all.
 */
export class OverlappingPayrollPeriodError extends ApplicationError {
  readonly code = 'APP.OVERLAPPING_PAYROLL_PERIOD';

  constructor(
    readonly period: string,
    readonly conflictingRunId: string,
    readonly conflictingPeriod: string,
  ) {
    super(`period ${period} overlaps run "${conflictingRunId}" (${conflictingPeriod})`);
  }
}

export class NoPayableEmployeesError extends ApplicationError {
  readonly code = 'APP.NO_PAYABLE_EMPLOYEES';

  constructor(readonly period: string) {
    super(`no active employees to pay for period ${period}`);
  }
}

/** Settlement was attempted on a run that has not been approved. */
export class PayrollRunNotPayableError extends ApplicationError {
  readonly code = 'APP.PAYROLL_RUN_NOT_PAYABLE';

  constructor(
    readonly runId: string,
    readonly status: PayrollRunStatus,
  ) {
    super(`payroll run "${runId}" is "${status}"; only an approved run can be settled`);
  }
}
