import { IllegalStateTransitionError } from '../errors/illegal-state-transition.error.js';
import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { PayrollPeriod, type PayrollPeriodSnapshot } from '../value-objects/payroll-period.js';
import { PayrollRunId } from '../value-objects/payroll-run-id.js';
import { Payslip, type PayslipSnapshot } from '../value-objects/payslip.js';
import { Satoshis } from '../value-objects/satoshis.js';
import { Settlement, type SettlementSnapshot } from '../value-objects/settlement.js';

export const PayrollRunStatus = {
  /** Calculated but not yet signed off. */
  Draft: 'draft',
  /** Signed off; may be settled on chain. */
  Approved: 'approved',
  /** Paid — terminal. */
  Settled: 'settled',
  /** Broadcast failed; may be retried. */
  Failed: 'failed',
} as const;

export type PayrollRunStatus = (typeof PayrollRunStatus)[keyof typeof PayrollRunStatus];

export interface PayrollRunSnapshot {
  readonly id: string;
  readonly period: PayrollPeriodSnapshot;
  readonly status: PayrollRunStatus;
  readonly payslips: readonly PayslipSnapshot[];
  readonly openedAt: string;
  readonly approvedAt: string | null;
  readonly settlement: SettlementSnapshot | null;
  readonly failureReason: string | null;
}

export interface OpenPayrollRunProps {
  readonly id: PayrollRunId;
  readonly period: PayrollPeriod;
  readonly payslips: readonly Payslip[];
  readonly openedAt: Date;
}

/**
 * A payroll run: one pay period, the payslips it produced, and its progress
 * from calculation to on-chain settlement.
 *
 * The lifecycle is the point of this aggregate. Money only moves for an
 * `approved` run, `settled` is terminal so a run can never be paid twice, and a
 * failed broadcast lands in `failed` (retryable) rather than being lost or
 * mistaken for success.
 *
 *   draft ──approve──▶ approved ──markSettled──▶ settled
 *                          │  ▲
 *                markFailed│  │reopen
 *                          ▼  │
 *                        failed
 */
export class PayrollRun {
  private constructor(
    readonly id: PayrollRunId,
    readonly period: PayrollPeriod,
    private readonly lines: readonly Payslip[],
    private currentStatus: PayrollRunStatus,
    private readonly openedAtMs: number,
    private approvedAtMs: number | null,
    private currentSettlement: Settlement | null,
    private currentFailureReason: string | null,
  ) {}

  static open(props: OpenPayrollRunProps): PayrollRun {
    const { id, period, payslips, openedAt } = props;

    if (payslips.length === 0) {
      throw new InvariantViolationError('PayrollRun', `no payable employees for period ${period.label}`);
    }
    if (Number.isNaN(openedAt.getTime())) {
      throw new InvariantViolationError('PayrollRun', 'openedAt must be a valid date');
    }

    const employeeIds = new Set(payslips.map((payslip) => payslip.employeeId.value));
    if (employeeIds.size !== payslips.length) {
      throw new InvariantViolationError('PayrollRun', 'an employee may only appear once per run');
    }

    return new PayrollRun(
      id,
      period,
      [...payslips],
      PayrollRunStatus.Draft,
      openedAt.getTime(),
      null,
      null,
      null,
    );
  }

  static fromSnapshot(snapshot: PayrollRunSnapshot): PayrollRun {
    return new PayrollRun(
      PayrollRunId.of(snapshot.id),
      PayrollPeriod.fromSnapshot(snapshot.period),
      snapshot.payslips.map(Payslip.fromSnapshot),
      snapshot.status,
      new Date(snapshot.openedAt).getTime(),
      snapshot.approvedAt === null ? null : new Date(snapshot.approvedAt).getTime(),
      snapshot.settlement === null ? null : Settlement.fromSnapshot(snapshot.settlement),
      snapshot.failureReason,
    );
  }

  get status(): PayrollRunStatus {
    return this.currentStatus;
  }

  get payslips(): readonly Payslip[] {
    return this.lines;
  }

  get headcount(): number {
    return this.lines.length;
  }

  get openedAt(): Date {
    return new Date(this.openedAtMs);
  }

  get approvedAt(): Date | null {
    return this.approvedAtMs === null ? null : new Date(this.approvedAtMs);
  }

  get settlement(): Settlement | null {
    return this.currentSettlement;
  }

  get failureReason(): string | null {
    return this.currentFailureReason;
  }

  /** Total that must leave the treasury, excluding the miner fee. */
  get totalNet(): Satoshis {
    return Satoshis.sum(this.lines.map((payslip) => payslip.net));
  }

  get totalGross(): Satoshis {
    return Satoshis.sum(this.lines.map((payslip) => payslip.gross));
  }

  get totalWithheld(): Satoshis {
    return Satoshis.sum(this.lines.map((payslip) => payslip.withheld));
  }

  /** True once money has moved. Guards against paying the same period twice. */
  isSettled(): boolean {
    return this.currentStatus === PayrollRunStatus.Settled;
  }

  isPayable(): boolean {
    return this.currentStatus === PayrollRunStatus.Approved;
  }

  approve(at: Date): void {
    this.assertStatus(PayrollRunStatus.Approved, [PayrollRunStatus.Draft]);
    this.approvedAtMs = at.getTime();
    this.currentStatus = PayrollRunStatus.Approved;
    this.currentFailureReason = null;
  }

  markSettled(settlement: Settlement): void {
    this.assertStatus(PayrollRunStatus.Settled, [PayrollRunStatus.Approved]);
    this.currentSettlement = settlement;
    this.currentFailureReason = null;
    this.currentStatus = PayrollRunStatus.Settled;
  }

  markFailed(reason: string): void {
    this.assertStatus(PayrollRunStatus.Failed, [PayrollRunStatus.Approved]);
    this.currentFailureReason = reason;
    this.currentStatus = PayrollRunStatus.Failed;
  }

  /** Put a failed run back in the payable state so it can be retried. */
  reopen(): void {
    this.assertStatus(PayrollRunStatus.Approved, [PayrollRunStatus.Failed]);
    this.currentFailureReason = null;
    this.currentStatus = PayrollRunStatus.Approved;
  }

  toSnapshot(): PayrollRunSnapshot {
    return {
      id: this.id.value,
      period: this.period.toSnapshot(),
      status: this.currentStatus,
      payslips: this.lines.map((payslip) => payslip.toSnapshot()),
      openedAt: this.openedAt.toISOString(),
      approvedAt: this.approvedAt?.toISOString() ?? null,
      settlement: this.currentSettlement?.toSnapshot() ?? null,
      failureReason: this.currentFailureReason,
    };
  }

  private assertStatus(target: PayrollRunStatus, allowedFrom: readonly PayrollRunStatus[]): void {
    if (!allowedFrom.includes(this.currentStatus)) {
      throw new IllegalStateTransitionError('PayrollRun', this.currentStatus, target);
    }
  }
}
