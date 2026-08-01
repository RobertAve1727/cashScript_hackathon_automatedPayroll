import type { PayrollRun, PayrollRunStatus, Payslip } from '../../domain/index.js';

export interface PayslipDto {
  readonly employeeId: string;
  readonly payoutAddress: string;
  readonly grossSats: string;
  readonly withheldSats: string;
  readonly netSats: string;
  readonly netBch: string;
}

export interface SettlementDto {
  readonly transactionId: string;
  readonly feePaidSats: string;
  readonly settledAt: string;
}

export interface PayrollRunDto {
  readonly id: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly periodLabel: string;
  readonly status: PayrollRunStatus;
  readonly headcount: number;
  readonly totalGrossSats: string;
  readonly totalWithheldSats: string;
  readonly totalNetSats: string;
  readonly totalNetBch: string;
  readonly payslips: readonly PayslipDto[];
  readonly openedAt: string;
  readonly approvedAt: string | null;
  readonly settlement: SettlementDto | null;
  readonly failureReason: string | null;
}

export function toPayslipDto(payslip: Payslip): PayslipDto {
  return {
    employeeId: payslip.employeeId.value,
    payoutAddress: payslip.payoutAddress.value,
    grossSats: payslip.gross.toString(),
    withheldSats: payslip.withheld.toString(),
    netSats: payslip.net.toString(),
    netBch: payslip.net.toBchString(),
  };
}

export function toPayrollRunDto(run: PayrollRun): PayrollRunDto {
  const settlement = run.settlement;

  return {
    id: run.id.value,
    periodStart: run.period.start.toISOString(),
    periodEnd: run.period.end.toISOString(),
    periodLabel: run.period.label,
    status: run.status,
    headcount: run.headcount,
    totalGrossSats: run.totalGross.toString(),
    totalWithheldSats: run.totalWithheld.toString(),
    totalNetSats: run.totalNet.toString(),
    totalNetBch: run.totalNet.toBchString(),
    payslips: run.payslips.map(toPayslipDto),
    openedAt: run.openedAt.toISOString(),
    approvedAt: run.approvedAt?.toISOString() ?? null,
    settlement:
      settlement === null
        ? null
        : {
            transactionId: settlement.reference,
            feePaidSats: settlement.feePaid.toString(),
            settledAt: settlement.settledAt.toISOString(),
          },
    failureReason: run.failureReason,
  };
}
