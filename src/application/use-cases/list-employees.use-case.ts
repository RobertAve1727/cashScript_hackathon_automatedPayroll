import type { EmployeeRepository } from '../../domain/index.js';
import { toEmployeeDto, type EmployeeDto } from '../dto/employee.dto.js';
import type { UseCase } from './use-case.js';

export interface ListEmployeesInput {
  /** When true, only employees eligible for the next payroll run. */
  readonly payableOnly?: boolean | undefined;
}

export class ListEmployeesUseCase implements UseCase<ListEmployeesInput, EmployeeDto[]> {
  constructor(private readonly employees: EmployeeRepository) {}

  async execute(input: ListEmployeesInput): Promise<EmployeeDto[]> {
    const roster = input.payableOnly === true ? await this.employees.findPayable() : await this.employees.findAll();

    return roster.map(toEmployeeDto);
  }
}
