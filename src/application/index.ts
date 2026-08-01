/**
 * Public surface of the application layer.
 *
 * Everything an outer layer is allowed to touch: the use cases it can invoke,
 * the DTOs it will get back, the ports it must implement, and the errors it
 * must handle. Nothing else about the application is reachable from outside.
 */

export { ApplicationError } from './errors/application-error.js';
export {
  DuplicatePayoutAddressError,
  EmployeeNotFoundError,
  InvalidPayoutAddressError,
  PayoutAddressNetworkMismatchError,
} from './errors/employee.errors.js';
export {
  NoPayableEmployeesError,
  OverlappingPayrollPeriodError,
  PayrollRunNotFoundError,
  PayrollRunNotPayableError,
} from './errors/payroll-run.errors.js';
export { DisbursementFailedError, InsufficientTreasuryFundsError } from './errors/treasury.errors.js';

export type { AddressValidation, AddressValidator } from './ports/address-validator.js';
export type { Clock } from './ports/clock.js';
export type { IdGenerator } from './ports/id-generator.js';
export type { LogContext, Logger } from './ports/logger.js';
export type {
  DisbursementLine,
  DisbursementReceipt,
  DisbursementRequest,
  PayrollDisbursementGateway,
  TreasurySummary,
} from './ports/payroll-disbursement-gateway.js';

export { toEmployeeDto, type EmployeeDto } from './dto/employee.dto.js';
export {
  toPayrollRunDto,
  toPayslipDto,
  type PayrollRunDto,
  type PayslipDto,
  type SettlementDto,
} from './dto/payroll-run.dto.js';
export { toTreasuryDto, type TreasuryDto } from './dto/treasury.dto.js';

export type { QueryUseCase, UseCase } from './use-cases/use-case.js';
export { EnrolEmployeeUseCase, type EnrolEmployeeInput } from './use-cases/enrol-employee.use-case.js';
export {
  UpdateEmployeePayUseCase,
  type UpdateEmployeePayInput,
} from './use-cases/update-employee-pay.use-case.js';
export {
  ChangeEmploymentStatusUseCase,
  EmploymentAction,
  type ChangeEmploymentStatusInput,
} from './use-cases/change-employment-status.use-case.js';
export { ListEmployeesUseCase, type ListEmployeesInput } from './use-cases/list-employees.use-case.js';
export { OpenPayrollRunUseCase, type OpenPayrollRunInput } from './use-cases/open-payroll-run.use-case.js';
export {
  ApprovePayrollRunUseCase,
  type ApprovePayrollRunInput,
} from './use-cases/approve-payroll-run.use-case.js';
export { SettlePayrollRunUseCase, type SettlePayrollRunInput } from './use-cases/settle-payroll-run.use-case.js';
export { GetPayrollRunUseCase, type GetPayrollRunInput } from './use-cases/get-payroll-run.use-case.js';
export { ListPayrollRunsUseCase } from './use-cases/list-payroll-runs.use-case.js';
export { InspectTreasuryUseCase } from './use-cases/inspect-treasury.use-case.js';
