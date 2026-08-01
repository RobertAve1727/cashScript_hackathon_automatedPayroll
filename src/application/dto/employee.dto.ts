import type { Employee, EmploymentStatus } from '../../domain/index.js';

/**
 * What the outside world sees of an employee.
 *
 * Flat, immutable, JSON-safe — no `bigint`, no `Date`, no domain classes. The
 * point is that a caller cannot reach through a DTO and mutate an aggregate,
 * and that a CLI, an HTTP handler or a queue consumer can all serialise it
 * without knowing the domain types.
 */
export interface EmployeeDto {
  readonly id: string;
  readonly fullName: string;
  readonly payoutAddress: string;
  readonly salaryPerPeriodSats: string;
  readonly salaryPerPeriodBch: string;
  readonly withholdingBps: number;
  readonly withholding: string;
  readonly status: EmploymentStatus;
  readonly payable: boolean;
  readonly enrolledAt: string;
}

export function toEmployeeDto(employee: Employee): EmployeeDto {
  return {
    id: employee.id.value,
    fullName: employee.fullName,
    payoutAddress: employee.payoutAddress.value,
    salaryPerPeriodSats: employee.salaryPerPeriod.toString(),
    salaryPerPeriodBch: employee.salaryPerPeriod.toBchString(),
    withholdingBps: employee.withholding.value,
    withholding: employee.withholding.toPercentageString(),
    status: employee.status,
    payable: employee.isPayable(),
    enrolledAt: employee.enrolledAt.toISOString(),
  };
}
