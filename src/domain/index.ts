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

export type { EmployeeRepository } from './repositories/employee-repository.js';
export type { PayrollRunRepository } from './repositories/payroll-run-repository.js';
