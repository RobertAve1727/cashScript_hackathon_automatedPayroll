/**
 * Public surface of the domain layer.
 *
 * Outer layers import from here; files *inside* the domain import each other
 * directly, so this barrel can never take part in an import cycle.
 */

export * from './constants.js';

export { DomainError } from './errors/domain-error.js';
export { IllegalStateTransitionError } from './errors/illegal-state-transition.error.js';
export { InvariantViolationError } from './errors/invariant-violation.error.js';

export { BasisPoints } from './value-objects/basis-points.js';
export { BchNetwork } from './value-objects/bch-network.js';
export { CashAddress } from './value-objects/cash-address.js';
export { EmployeeId } from './value-objects/employee-id.js';
export { Identifier } from './value-objects/identifier.js';
export { PayrollPeriod, type PayrollPeriodSnapshot } from './value-objects/payroll-period.js';
export { PayrollRunId } from './value-objects/payroll-run-id.js';
export { Payslip, type IssuePayslipProps, type PayslipSnapshot } from './value-objects/payslip.js';
export { Satoshis } from './value-objects/satoshis.js';
export { Settlement, type RecordSettlementProps, type SettlementSnapshot } from './value-objects/settlement.js';

export {
  Employee,
  EmploymentStatus,
  type EmployeeSnapshot,
  type EnrolEmployeeProps,
} from './entities/employee.js';
export {
  PayrollRun,
  PayrollRunStatus,
  type OpenPayrollRunProps,
  type PayrollRunSnapshot,
} from './entities/payroll-run.js';

export { PayrollCalculator } from './services/payroll-calculator.js';

// eSahod — Philippine private-sector statutory payroll.
export * from './statutory/rates.js';
export {
  computeDeductions,
  employerCost,
  monthlySalaryCredit,
  taxableCompensation,
  withholdingTaxSemiMonthly,
  type DeductionInput,
  type Deductions,
} from './statutory/deductions.js';
export {
  COMMITMENT_BYTES,
  COMMITMENT_LAYOUT,
  EMPLOYMENT_STATUS_ACTIVE,
  EMPLOYMENT_STATUS_INACTIVE,
  FIXTURES,
  FIXTURE_ANALYST,
  FIXTURE_ENTRY_LEVEL,
  OUTPUT_BIR,
  OUTPUT_EMPLOYEE,
  OUTPUT_PAGIBIG,
  OUTPUT_PHILHEALTH,
  OUTPUT_SSS,
  fixtureFullName,
  outputLayoutFor,
  type FixtureEmployee,
  type OutputLayout,
} from './payroll/types.js';
export {
  commitmentForEmployee,
  commitmentFromHex,
  commitmentToHex,
  decodeCommitment,
  encodeCommitment,
  MAX_ENCODABLE_PERIOD,
  type EmploymentCommitment,
  type EmploymentStatusCode,
  type EmploymentTerms,
} from './payroll/commitment.js';

// Pay cadence. The covenant takes `periodsPerMonth` as a constructor argument,
// so it settles any of these — one treasury per cadence, because that argument
// is part of the contract's address.
export {
  DAILY,
  MONTHLY_UNLAWFUL,
  SECONDS_PER_JULIAN_YEAR,
  SELECTABLE_SCHEDULES,
  SEMI_MONTHLY,
  WEEKLY,
  WORKING_DAYS_PER_MONTH,
  isLawfulCadence,
  isPayableNow,
  isPayrollCadence,
  payableAt,
  periodOfMonth,
  periodSecondsFor,
  periodsPerYear,
  rescaleEndPeriod,
  rescaleTaxPerPeriod,
  scheduleFor,
  type PayrollCadence,
  type PayrollSchedule,
} from './payroll/schedule.js';
// Night differential, rest-day and holiday premiums. Every premium in the
// Labor Code is a multiplier on the hourly rate and they COMPOUND, so an
// overtime night hour on a regular holiday is 200% x 130% x 110% = 286%.
export {
  DAY_CLASSIFICATIONS,
  DAY_LABELS,
  NIGHT_ENDS_HOUR,
  NIGHT_FACTOR_BP,
  NIGHT_STARTS_HOUR,
  ORDINARY_BP,
  PHT_OFFSET_MINUTES,
  hourFactorBasisPoints,
  isNightHour,
  nightMinutesIn,
  premiumPay,
  segmentsPay,
  unworkedDayPay,
  type DayClassification,
  type HourKind,
  type WorkSegment,
} from './attendance/premiums.js';
export {
  allocateMonthlyAmount,
  allocateMonthlyAmountAcrossMonth,
} from './statutory/allocation.js';
export {
  computeScheduledDeductions,
  monthlyObligations,
  scheduleMonth,
  type MonthlyObligations,
  type ScheduledDeductionInput,
  type ScheduledDeductions,
} from './statutory/scheduled-deductions.js';

// Attendance: the input a payroll covenant cannot supply for itself.
export {
  ANCHOR_BYTES,
  ANCHOR_MAGIC,
  ANCHOR_VERSION,
  PUNCH_KIND_CODE,
  STANDARD_WORKDAY_SECONDS,
  WORKDAY_BASIS_POINTS,
  decodePunch,
  encodePunch,
  isSettled,
  totalBasisPoints,
  workedBasisPoints,
  workedFraction,
  workedSeconds,
  type Punch,
  type PunchKind,
  type TimeRecord,
} from './attendance/time-record.js';
export {
  MAX_OVERTIME_MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  OVERTIME_PREMIUM_PERCENT,
  approvedOvertimeMinutes,
  approvedOvertimePay,
  assertRequestable,
  decide,
  hourlyRate,
  overtimePay,
  type OvertimeRequest,
  type OvertimeStatus,
} from './attendance/overtime.js';

export type { EmployeeRepository } from './repositories/employee-repository.js';
export type { PayrollRunRepository } from './repositories/payroll-run-repository.js';
