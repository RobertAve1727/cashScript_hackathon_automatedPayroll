import { describe, expect, it } from 'vitest';
import {
  IllegalStateTransitionError,
  InvariantViolationError,
  PayrollRun,
  PayrollRunId,
  PayrollRunStatus,
  Satoshis,
  Settlement,
} from '../../src/domain/index.js';
import { BOB_TESTNET } from '../support/addresses.js';
import { anApprovedPayrollRun, aPayrollRun, aPayslip, aPeriod, anEmployee } from '../support/builders.js';

const TXID = 'b'.repeat(64);

function aSettlement(): Settlement {
  return Settlement.record({
    reference: TXID,
    feePaid: Satoshis.from(342n),
    settledAt: new Date('2026-08-16T11:00:00.000Z'),
  });
}

describe('PayrollRun', () => {
  describe('opening', () => {
    it('refuses a run with no payslips', () => {
      expect(() =>
        PayrollRun.open({ id: PayrollRunId.of('run-1'), period: aPeriod(), payslips: [], openedAt: new Date() }),
      ).toThrow(/no payable employees/);
    });

    it('refuses to pay the same employee twice in one run', () => {
      const payslip = aPayslip();

      expect(() => aPayrollRun({ payslips: [payslip, payslip] })).toThrow(/only appear once/);
    });

    it('starts as a draft', () => {
      expect(aPayrollRun().status).toBe(PayrollRunStatus.Draft);
      expect(aPayrollRun().isPayable()).toBe(false);
    });
  });

  describe('totals', () => {
    it('sums gross, withheld and net across payslips', () => {
      const run = aPayrollRun({
        payslips: [
          aPayslip(anEmployee({ id: 'emp-1', salaryBch: '1', withholdingBps: 1_000 })),
          aPayslip(anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET, salaryBch: '0.5', withholdingBps: 0 })),
        ],
      });

      expect(run.headcount).toBe(2);
      expect(run.totalGross.toBchString()).toBe('1.5');
      expect(run.totalWithheld.toBchString()).toBe('0.1');
      expect(run.totalNet.toBchString()).toBe('1.4');
    });
  });

  describe('lifecycle', () => {
    it('goes draft -> approved -> settled', () => {
      const run = aPayrollRun();

      run.approve(new Date('2026-08-16T10:00:00.000Z'));
      expect(run.status).toBe(PayrollRunStatus.Approved);
      expect(run.isPayable()).toBe(true);

      run.markSettled(aSettlement());
      expect(run.status).toBe(PayrollRunStatus.Settled);
      expect(run.isSettled()).toBe(true);
      expect(run.settlement?.reference).toBe(TXID);
    });

    it('cannot settle a draft — money only moves for an approved run', () => {
      expect(() => aPayrollRun().markSettled(aSettlement())).toThrow(IllegalStateTransitionError);
    });

    it('cannot settle twice', () => {
      const run = anApprovedPayrollRun();
      run.markSettled(aSettlement());

      expect(() => run.markSettled(aSettlement())).toThrow(IllegalStateTransitionError);
    });

    it('cannot approve a settled run', () => {
      const run = anApprovedPayrollRun();
      run.markSettled(aSettlement());

      expect(() => run.approve(new Date())).toThrow(IllegalStateTransitionError);
    });

    it('records a failure reason and allows a retry through reopen', () => {
      const run = anApprovedPayrollRun();

      run.markFailed('network refused the transaction');
      expect(run.status).toBe(PayrollRunStatus.Failed);
      expect(run.failureReason).toBe('network refused the transaction');

      run.reopen();
      expect(run.status).toBe(PayrollRunStatus.Approved);
      expect(run.failureReason).toBeNull();
    });

    it('will not reopen a run that never failed', () => {
      expect(() => aPayrollRun().reopen()).toThrow(IllegalStateTransitionError);
    });
  });

  describe('settlement', () => {
    it('rejects a reference that is not a transaction id', () => {
      expect(() =>
        Settlement.record({ reference: 'not-a-txid', feePaid: Satoshis.ZERO, settledAt: new Date() }),
      ).toThrow(InvariantViolationError);
    });
  });

  describe('persistence', () => {
    it('round-trips a settled run through a snapshot', () => {
      const run = anApprovedPayrollRun();
      run.markSettled(aSettlement());

      const restored = PayrollRun.fromSnapshot(run.toSnapshot());

      expect(restored.toSnapshot()).toEqual(run.toSnapshot());
      expect(restored.totalNet.equals(run.totalNet)).toBe(true);
      expect(restored.isSettled()).toBe(true);
    });

    it('round-trips a failed run', () => {
      const run = anApprovedPayrollRun();
      run.markFailed('insufficient fee');

      expect(PayrollRun.fromSnapshot(run.toSnapshot()).failureReason).toBe('insufficient fee');
    });

    it('produces a JSON-safe snapshot', () => {
      const snapshot = aPayrollRun().toSnapshot();

      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
    });
  });
});
