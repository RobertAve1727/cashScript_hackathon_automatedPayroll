import type { PayrollRunDto } from '../../../application/index.js';
import { formatTable } from './table.js';

export function presentPayrollRun(run: PayrollRunDto, asJson: boolean): string {
  if (asJson) return JSON.stringify(run, null, 2);

  const header = [
    `run        ${run.id}`,
    `period     ${run.periodLabel}`,
    `status     ${run.status}`,
    `headcount  ${run.headcount}`,
    `gross      ${run.totalGrossSats} sats`,
    `withheld   ${run.totalWithheldSats} sats`,
    `net        ${run.totalNetBch} BCH (${run.totalNetSats} sats)`,
  ];

  if (run.settlement !== null) {
    header.push(
      `txid       ${run.settlement.transactionId}`,
      `fee        ${run.settlement.feePaidSats} sats`,
      `settled    ${run.settlement.settledAt}`,
    );
  }
  if (run.failureReason !== null) {
    header.push(`failure    ${run.failureReason}`);
  }

  const payslips = formatTable(
    ['EMPLOYEE', 'GROSS', 'WITHHELD', 'NET (BCH)', 'PAYOUT ADDRESS'],
    run.payslips.map((payslip) => [
      payslip.employeeId,
      payslip.grossSats,
      payslip.withheldSats,
      payslip.netBch,
      payslip.payoutAddress,
    ]),
  );

  return `${header.join('\n')}\n\n${payslips}`;
}

export function presentPayrollRuns(runs: readonly PayrollRunDto[], asJson: boolean): string {
  if (asJson) return JSON.stringify(runs, null, 2);
  if (runs.length === 0) return 'no payroll runs yet';

  return formatTable(
    ['ID', 'PERIOD', 'STATUS', 'HEADCOUNT', 'NET (BCH)', 'TXID'],
    runs.map((run) => [
      run.id,
      run.periodLabel,
      run.status,
      String(run.headcount),
      run.totalNetBch,
      run.settlement?.transactionId ?? '-',
    ]),
  );
}
