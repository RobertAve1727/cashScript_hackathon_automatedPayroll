import { BasisPoints, EmployeeId, Satoshis, type EmployeeRepository } from '../../domain/index.js';
import { toEmployeeDto, type EmployeeDto } from '../dto/employee.dto.js';
import { EmployeeNotFoundError } from '../errors/employee.errors.js';
import type { Logger } from '../ports/logger.js';
import type { UseCase } from './use-case.js';

export interface UpdateEmployeePayInput {
  readonly employeeId: string;
  /** New salary per period as a decimal BCH string. Omit to leave unchanged. */
  readonly salaryBch?: string | undefined;
  /** New withholding in basis points. Omit to leave unchanged. */
  readonly withholdingBps?: number | undefined;
}

/**
 * Change what an employee is paid.
 *
 * The use case only decides *which* fields were asked for; whether the change
 * is allowed at all (an offboarded employee cannot be repriced, a salary cannot
 * be zero) is the aggregate's call.
 */
export class UpdateEmployeePayUseCase implements UseCase<UpdateEmployeePayInput, EmployeeDto> {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly logger: Logger,
  ) {}

  async execute(input: UpdateEmployeePayInput): Promise<EmployeeDto> {
    const employee = await this.employees.findById(EmployeeId.of(input.employeeId));
    if (employee === null) {
      throw new EmployeeNotFoundError(input.employeeId);
    }

    if (input.salaryBch !== undefined) {
      employee.changeSalary(Satoshis.fromBch(input.salaryBch));
    }
    if (input.withholdingBps !== undefined) {
      employee.changeWithholding(BasisPoints.of(input.withholdingBps));
    }

    await this.employees.save(employee);

    this.logger.info('employee pay updated', {
      employeeId: employee.id.value,
      salarySats: employee.salaryPerPeriod.toString(),
      withholdingBps: employee.withholding.value,
    });

    return toEmployeeDto(employee);
  }
}
