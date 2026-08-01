import type { EmployeeDto } from '../../../application/index.js';
import { formatTable } from './table.js';

export function presentEmployee(employee: EmployeeDto, asJson: boolean): string {
  if (asJson) return JSON.stringify(employee, null, 2);

  return [
    `id         ${employee.id}`,
    `name       ${employee.fullName}`,
    `address    ${employee.payoutAddress}`,
    `salary     ${employee.salaryPerPeriodBch} BCH (${employee.salaryPerPeriodSats} sats) per period`,
    `withheld   ${employee.withholding}`,
    `status     ${employee.status}`,
    `enrolled   ${employee.enrolledAt}`,
  ].join('\n');
}

export function presentEmployees(employees: readonly EmployeeDto[], asJson: boolean): string {
  if (asJson) return JSON.stringify(employees, null, 2);
  if (employees.length === 0) return 'no employees enrolled';

  return formatTable(
    ['ID', 'NAME', 'SALARY (BCH)', 'WITHHELD', 'STATUS', 'PAYOUT ADDRESS'],
    employees.map((employee) => [
      employee.id,
      employee.fullName,
      employee.salaryPerPeriodBch,
      employee.withholding,
      employee.status,
      employee.payoutAddress,
    ]),
  );
}
