import {
  BasisPoints,
  CashAddress,
  Employee,
  EmployeeId,
  PayrollPeriod,
  PayrollRun,
  PayrollRunId,
  Payslip,
  Satoshis,
} from '../../src/domain/index.js';
import { ALICE_TESTNET } from './addresses.js';

export interface EmployeeOverrides {
  readonly id?: string;
  readonly fullName?: string;
  readonly payoutAddress?: string;
  readonly salaryBch?: string;
  readonly withholdingBps?: number;
  readonly enrolledAt?: Date;
}

/** An active employee with sensible defaults; override only what a test cares about. */
export function anEmployee(overrides: EmployeeOverrides = {}): Employee {
  return Employee.enrol({
    id: EmployeeId.of(overrides.id ?? 'emp-1'),
    fullName: overrides.fullName ?? 'Alice Rivera',
    payoutAddress: CashAddress.parse(overrides.payoutAddress ?? ALICE_TESTNET),
    salaryPerPeriod: Satoshis.fromBch(overrides.salaryBch ?? '0.5'),
    withholding: BasisPoints.of(overrides.withholdingBps ?? 0),
    enrolledAt: overrides.enrolledAt ?? new Date('2026-01-01T00:00:00.000Z'),
  });
}

export function aPeriod(start = '2026-08-01T00:00:00.000Z', end = '2026-08-16T00:00:00.000Z'): PayrollPeriod {
  return PayrollPeriod.between(new Date(start), new Date(end));
}

export function aPayslip(employee: Employee = anEmployee()): Payslip {
  return Payslip.issue({
    employeeId: employee.id,
    payoutAddress: employee.payoutAddress,
    gross: employee.salaryPerPeriod,
    withholding: employee.withholding,
  });
}

export interface PayrollRunOverrides {
  readonly id?: string;
  readonly period?: PayrollPeriod;
  readonly payslips?: readonly Payslip[];
  readonly openedAt?: Date;
}

export function aPayrollRun(overrides: PayrollRunOverrides = {}): PayrollRun {
  return PayrollRun.open({
    id: PayrollRunId.of(overrides.id ?? 'run-1'),
    period: overrides.period ?? aPeriod(),
    payslips: overrides.payslips ?? [aPayslip()],
    openedAt: overrides.openedAt ?? new Date('2026-08-16T09:00:00.000Z'),
  });
}

/** A run in the only state from which settlement is allowed. */
export function anApprovedPayrollRun(overrides: PayrollRunOverrides = {}): PayrollRun {
  const run = aPayrollRun(overrides);
  run.approve(new Date('2026-08-16T10:00:00.000Z'));

  return run;
}
