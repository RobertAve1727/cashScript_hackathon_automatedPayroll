import { PayrollRunId, type PayrollRunRepository } from '../../domain/index.js';
import { toPayrollRunDto, type PayrollRunDto } from '../dto/payroll-run.dto.js';
import { PayrollRunNotFoundError } from '../errors/payroll-run.errors.js';
import type { UseCase } from './use-case.js';

export interface GetPayrollRunInput {
  readonly runId: string;
}

export class GetPayrollRunUseCase implements UseCase<GetPayrollRunInput, PayrollRunDto> {
  constructor(private readonly runs: PayrollRunRepository) {}

  async execute(input: GetPayrollRunInput): Promise<PayrollRunDto> {
    const run = await this.runs.findById(PayrollRunId.of(input.runId));
    if (run === null) {
      throw new PayrollRunNotFoundError(input.runId);
    }

    return toPayrollRunDto(run);
  }
}
