import { PayrollRunId, PayrollRunStatus, type PayrollRunRepository } from '../../domain/index.js';
import { toPayrollRunDto, type PayrollRunDto } from '../dto/payroll-run.dto.js';
import { PayrollRunNotFoundError } from '../errors/payroll-run.errors.js';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type { UseCase } from './use-case.js';

export interface ApprovePayrollRunInput {
  readonly runId: string;
}

/**
 * Sign off a run so it becomes payable.
 *
 * Also the retry path: a run whose broadcast failed is reopened rather than
 * approved afresh, so the failure is cleared without recalculating payslips
 * that were already reviewed.
 */
export class ApprovePayrollRunUseCase implements UseCase<ApprovePayrollRunInput, PayrollRunDto> {
  constructor(
    private readonly runs: PayrollRunRepository,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(input: ApprovePayrollRunInput): Promise<PayrollRunDto> {
    const run = await this.runs.findById(PayrollRunId.of(input.runId));
    if (run === null) {
      throw new PayrollRunNotFoundError(input.runId);
    }

    if (run.status === PayrollRunStatus.Failed) {
      run.reopen();
    } else {
      run.approve(this.clock.now());
    }

    await this.runs.save(run);
    this.logger.info('payroll run approved', { runId: run.id.value, headcount: run.headcount });

    return toPayrollRunDto(run);
  }
}
