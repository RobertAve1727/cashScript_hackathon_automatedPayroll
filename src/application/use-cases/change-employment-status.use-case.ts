import { EmployeeId, InvariantViolationError, type EmployeeRepository } from '../../domain/index.js';
import { toEmployeeDto, type EmployeeDto } from '../dto/employee.dto.js';
import { EmployeeNotFoundError } from '../errors/employee.errors.js';
import type { Logger } from '../ports/logger.js';
import type { UseCase } from './use-case.js';

export const EmploymentAction = {
  Suspend: 'suspend',
  Reinstate: 'reinstate',
  Offboard: 'offboard',
} as const;

export type EmploymentAction = (typeof EmploymentAction)[keyof typeof EmploymentAction];

export interface ChangeEmploymentStatusInput {
  readonly employeeId: string;
  readonly action: EmploymentAction;
}

/**
 * Move an employee through their employment lifecycle.
 *
 * Each action maps to one aggregate method — the legality of the transition
 * (you cannot reinstate someone who was offboarded) is decided by `Employee`,
 * not here. This class only translates an external action name into the right
 * call, which is exactly as much as an application service should do.
 */
export class ChangeEmploymentStatusUseCase implements UseCase<ChangeEmploymentStatusInput, EmployeeDto> {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly logger: Logger,
  ) {}

  async execute(input: ChangeEmploymentStatusInput): Promise<EmployeeDto> {
    const employee = await this.employees.findById(EmployeeId.of(input.employeeId));
    if (employee === null) {
      throw new EmployeeNotFoundError(input.employeeId);
    }

    switch (input.action) {
      case EmploymentAction.Suspend:
        employee.suspend();
        break;
      case EmploymentAction.Reinstate:
        employee.reinstate();
        break;
      case EmploymentAction.Offboard:
        employee.offboard();
        break;
      default:
        throw new InvariantViolationError('EmploymentAction', `unknown action "${String(input.action)}"`);
    }

    await this.employees.save(employee);
    this.logger.info('employment status changed', {
      employeeId: employee.id.value,
      status: employee.status,
    });

    return toEmployeeDto(employee);
  }
}
