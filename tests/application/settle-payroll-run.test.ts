import { beforeEach, describe, expect, it } from 'vitest';
import {
  ApprovePayrollRunUseCase,
  DisbursementFailedError,
  InsufficientTreasuryFundsError,
  PayrollRunNotFoundError,
  PayrollRunNotPayableError,
  SettlePayrollRunUseCase,
} from '../../src/application/index.js';
import { PayrollRunId, PayrollRunStatus, Satoshis } from '../../src/domain/index.js';
import { InMemoryPayrollRunRepository } from '../../src/infrastructure/index.js';
import { BOB_TESTNET } from '../support/addresses.js';
import { aPayrollRun, aPayslip, anApprovedPayrollRun, anEmployee } from '../support/builders.js';
import { FixedClock, RecordingLogger, StubDisbursementGateway } from '../support/fakes.js';

const SETTLED_AT = new Date('2026-08-16T11:30:00.000Z');
const TXID = 'c'.repeat(64);

describe('SettlePayrollRunUseCase', () => {
  let runs: InMemoryPayrollRunRepository;
  let clock: FixedClock;
  let logger: RecordingLogger;

  const settleWith = (gateway: StubDisbursementGateway): SettlePayrollRunUseCase =>
    new SettlePayrollRunUseCase(runs, gateway, clock, logger);

  beforeEach(() => {
    runs = new InMemoryPayrollRunRepository();
    clock = new FixedClock(SETTLED_AT);
    logger = new RecordingLogger();
  });

  describe('when the run settles', () => {
    it('records the transaction, fee and time', async () => {
      await runs.save(anApprovedPayrollRun());
      const gateway = new StubDisbursementGateway({ transactionId: TXID, fee: Satoshis.from(342n) });

      const run = await settleWith(gateway).execute({ runId: 'run-1' });

      expect(run.status).toBe(PayrollRunStatus.Settled);
      expect(run.settlement).toEqual({
        transactionId: TXID,
        feePaidSats: '342',
        settledAt: SETTLED_AT.toISOString(),
      });
    });

    it('persists the settled state', async () => {
      await runs.save(anApprovedPayrollRun());

      await settleWith(new StubDisbursementGateway()).execute({ runId: 'run-1' });

      const stored = await runs.findById(PayrollRunId.of('run-1'));
      expect(stored?.isSettled()).toBe(true);
    });

    it('asks the gateway to pay every payslip, tagged with the run id', async () => {
      await runs.save(
        anApprovedPayrollRun({
          payslips: [
            aPayslip(anEmployee({ id: 'emp-1', salaryBch: '1', withholdingBps: 1_000 })),
            aPayslip(anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET, salaryBch: '0.5' })),
          ],
        }),
      );
      const gateway = new StubDisbursementGateway();

      await settleWith(gateway).execute({ runId: 'run-1' });

      const request = gateway.requests[0];
      expect(request?.reference).toBe('run-1');
      expect(request?.lines.map((line) => line.amount.toString())).toEqual(['90000000', '50000000']);
    });

    it('refuses to settle the same run twice', async () => {
      await runs.save(anApprovedPayrollRun());
      const gateway = new StubDisbursementGateway();
      const useCase = settleWith(gateway);

      await useCase.execute({ runId: 'run-1' });

      await expect(useCase.execute({ runId: 'run-1' })).rejects.toThrow(PayrollRunNotPayableError);
      expect(gateway.requests).toHaveLength(1);
    });
  });

  describe('when the run may not be settled', () => {
    it('rejects an unknown run', async () => {
      await expect(settleWith(new StubDisbursementGateway()).execute({ runId: 'nope' })).rejects.toThrow(
        PayrollRunNotFoundError,
      );
    });

    it('refuses a draft that was never approved, without touching the gateway', async () => {
      await runs.save(aPayrollRun());
      const gateway = new StubDisbursementGateway();

      await expect(settleWith(gateway).execute({ runId: 'run-1' })).rejects.toThrow(PayrollRunNotPayableError);
      expect(gateway.requests).toHaveLength(0);
    });

    it('refuses when the treasury cannot cover the run, before building a transaction', async () => {
      await runs.save(anApprovedPayrollRun());
      const gateway = new StubDisbursementGateway({ balance: Satoshis.from(1_000n) });

      await expect(settleWith(gateway).execute({ runId: 'run-1' })).rejects.toThrow(
        InsufficientTreasuryFundsError,
      );
      expect(gateway.requests).toHaveLength(0);
    });

    it('leaves an underfunded run approved so it can be settled after a top-up', async () => {
      await runs.save(anApprovedPayrollRun());

      await expect(
        settleWith(new StubDisbursementGateway({ balance: Satoshis.ZERO })).execute({ runId: 'run-1' }),
      ).rejects.toThrow(InsufficientTreasuryFundsError);

      const stored = await runs.findById(PayrollRunId.of('run-1'));
      expect(stored?.status).toBe(PayrollRunStatus.Approved);
    });
  });

  describe('when the broadcast fails', () => {
    const failing = (): StubDisbursementGateway =>
      new StubDisbursementGateway({ failWith: new Error('node refused: mempool conflict') });

    it('raises a DisbursementFailedError carrying the reason', async () => {
      await runs.save(anApprovedPayrollRun());

      const rejection = settleWith(failing()).execute({ runId: 'run-1' });

      await expect(rejection).rejects.toBeInstanceOf(DisbursementFailedError);
      await expect(rejection).rejects.toThrow(/mempool conflict/);
    });

    it('persists the failure and its reason', async () => {
      await runs.save(anApprovedPayrollRun());

      await expect(settleWith(failing()).execute({ runId: 'run-1' })).rejects.toThrow();

      const stored = await runs.findById(PayrollRunId.of('run-1'));
      expect(stored?.status).toBe(PayrollRunStatus.Failed);
      expect(stored?.failureReason).toBe('node refused: mempool conflict');
    });

    it('logs the failure', async () => {
      await runs.save(anApprovedPayrollRun());

      await expect(settleWith(failing()).execute({ runId: 'run-1' })).rejects.toThrow();

      expect(logger.messages('error')).toContain('payroll run settlement failed');
    });

    it('can be retried: approve reopens the failed run, then it settles', async () => {
      await runs.save(anApprovedPayrollRun());
      await expect(settleWith(failing()).execute({ runId: 'run-1' })).rejects.toThrow();

      await new ApprovePayrollRunUseCase(runs, clock, logger).execute({ runId: 'run-1' });
      const run = await settleWith(new StubDisbursementGateway({ transactionId: TXID })).execute({
        runId: 'run-1',
      });

      expect(run.status).toBe(PayrollRunStatus.Settled);
      expect(run.failureReason).toBeNull();
      expect(run.settlement?.transactionId).toBe(TXID);
    });
  });
});
