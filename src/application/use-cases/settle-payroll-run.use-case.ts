import { PayrollRunId, Settlement, type PayrollRun, type PayrollRunRepository } from '../../domain/index.js';
import { toPayrollRunDto, type PayrollRunDto } from '../dto/payroll-run.dto.js';
import { PayrollRunNotFoundError, PayrollRunNotPayableError } from '../errors/payroll-run.errors.js';
import { DisbursementFailedError, InsufficientTreasuryFundsError } from '../errors/treasury.errors.js';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type {
  DisbursementReceipt,
  PayrollDisbursementGateway,
} from '../ports/payroll-disbursement-gateway.js';
import type { UseCase } from './use-case.js';

export interface SettlePayrollRunInput {
  readonly runId: string;
}

/**
 * Pay an approved run on chain.
 *
 * The only use case that moves money, so it is the only one with real failure
 * handling:
 *
 *  1. refuse outright unless the run is `approved` — no double payment, no
 *     paying an unreviewed draft;
 *  2. check the treasury covers the run *before* building a transaction, so the
 *     common failure produces a clear message instead of a rejected broadcast;
 *  3. if the broadcast still fails, record `failed` with the reason and persist
 *     it before rethrowing. A crash between "money left" and "we wrote it down"
 *     is the one thing payroll cannot tolerate, and the retry path
 *     (`ApprovePayrollRun` → reopen) exists precisely so that state is not a
 *     dead end.
 *
 * Fees are deliberately not part of the funding check: the gateway owns fee
 * estimation, and how much slack a treasury keeps is an operational decision,
 * not a business rule this use case should hardcode.
 */
export class SettlePayrollRunUseCase implements UseCase<SettlePayrollRunInput, PayrollRunDto> {
  constructor(
    private readonly runs: PayrollRunRepository,
    private readonly gateway: PayrollDisbursementGateway,
    private readonly clock: Clock,
    private readonly logger: Logger,
  ) {}

  async execute(input: SettlePayrollRunInput): Promise<PayrollRunDto> {
    const run = await this.runs.findById(PayrollRunId.of(input.runId));
    if (run === null) {
      throw new PayrollRunNotFoundError(input.runId);
    }
    if (!run.isPayable()) {
      throw new PayrollRunNotPayableError(run.id.value, run.status);
    }

    const treasury = await this.gateway.summarise();
    if (!treasury.availableFunds.isAtLeast(run.totalNet)) {
      throw new InsufficientTreasuryFundsError(run.totalNet, treasury.availableFunds);
    }

    const receipt = await this.disburse(run);

    run.markSettled(
      Settlement.record({
        reference: receipt.transactionId,
        feePaid: receipt.feePaid,
        settledAt: this.clock.now(),
      }),
    );
    await this.runs.save(run);

    this.logger.info('payroll run settled', {
      runId: run.id.value,
      transactionId: receipt.transactionId,
      headcount: run.headcount,
      totalNetSats: run.totalNet.toString(),
      feeSats: receipt.feePaid.toString(),
    });

    return toPayrollRunDto(run);
  }

  /**
   * Broadcast the payment, and on failure record *why* on the run before the
   * error propagates — a failed run with no reason attached is unactionable.
   */
  private async disburse(run: PayrollRun): Promise<DisbursementReceipt> {
    try {
      return await this.gateway.disburse({
        reference: run.id.value,
        lines: run.payslips.map((payslip) => ({
          recipient: payslip.payoutAddress,
          amount: payslip.net,
        })),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      run.markFailed(reason);
      await this.runs.save(run);
      this.logger.error('payroll run settlement failed', { runId: run.id.value, reason });

      throw error instanceof DisbursementFailedError ? error : new DisbursementFailedError(reason, { cause: error });
    }
  }
}
