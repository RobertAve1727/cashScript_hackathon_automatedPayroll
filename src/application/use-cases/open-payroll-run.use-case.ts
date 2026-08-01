import {
  PayrollPeriod,
  PayrollRun,
  PayrollRunId,
  PayrollRunStatus,
  type EmployeeRepository,
  type PayrollCalculator,
  type PayrollRunRepository,
} from '../../domain/index.js';
import { toPayrollRunDto, type PayrollRunDto } from '../dto/payroll-run.dto.js';
import { NoPayableEmployeesError, OverlappingPayrollPeriodError } from '../errors/payroll-run.errors.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Logger } from '../ports/logger.js';
import type { UseCase } from './use-case.js';

export interface OpenPayrollRunInput {
  /** Inclusive start of the pay period, ISO-8601. */
  readonly periodStart: string;
  /** Exclusive end of the pay period, ISO-8601. */
  readonly periodEnd: string;
}

/**
 * Calculate a payroll run for a period and leave it in `draft` for review.
 *
 * Opening a run moves no money — that separation is the whole reason `draft`
 * exists. It also refuses to open a run overlapping an existing one unless that
 * one failed, which is the guard against paying the same fortnight twice under
 * two different run ids.
 */
export class OpenPayrollRunUseCase implements UseCase<OpenPayrollRunInput, PayrollRunDto> {
  constructor(
    private readonly runs: PayrollRunRepository,
    private readonly employees: EmployeeRepository,
    private readonly calculator: PayrollCalculator,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(input: OpenPayrollRunInput): Promise<PayrollRunDto> {
    const period = PayrollPeriod.between(new Date(input.periodStart), new Date(input.periodEnd));

    const overlapping = await this.runs.findOverlapping(period);
    const blocking = overlapping.find((run) => run.status !== PayrollRunStatus.Failed);
    if (blocking !== undefined) {
      throw new OverlappingPayrollPeriodError(period.label, blocking.id.value, blocking.period.label);
    }

    const roster = await this.employees.findPayable();
    const payslips = this.calculator.calculate(roster);
    if (payslips.length === 0) {
      throw new NoPayableEmployeesError(period.label);
    }

    const run = PayrollRun.open({
      id: PayrollRunId.of(this.idGenerator.next()),
      period,
      payslips,
      openedAt: this.clock.now(),
    });

    await this.runs.save(run);

    this.logger.info('payroll run opened', {
      runId: run.id.value,
      period: period.label,
      headcount: run.headcount,
      totalNetSats: run.totalNet.toString(),
    });

    return toPayrollRunDto(run);
  }
}
