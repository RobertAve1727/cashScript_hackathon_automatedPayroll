import type { PayrollRunRepository } from '../../domain/index.js';
import { toPayrollRunDto, type PayrollRunDto } from '../dto/payroll-run.dto.js';
import type { QueryUseCase } from './use-case.js';

export class ListPayrollRunsUseCase implements QueryUseCase<PayrollRunDto[]> {
  constructor(private readonly runs: PayrollRunRepository) {}

  async execute(): Promise<PayrollRunDto[]> {
    const runs = await this.runs.findAll();

    return runs.map(toPayrollRunDto);
  }
}
