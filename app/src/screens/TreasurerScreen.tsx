import { useState } from 'react';

import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types';
import { computeDeductions } from '@domain/statutory/deductions';

import type { PayrollRun } from '../chain/gateway';
import { chainGateway } from '../chain/mock-chain-gateway';
import { errorMessage, useChainState } from '../chain/use-chain';
import { OutputDiagram } from '../components/OutputDiagram';
import { Card, ErrorNote, Loading, SectionTitle, StatusBadge } from '../components/ui';
import { formatEphp, formatPeso, truncateHex } from '../lib/format';

/**
 * /treasurer — the payroll officer's console. The role is deliberately
 * powerless: the Run buttons trigger disbursement but cannot redirect a
 * centavo, because every payee is enforced by the covenant.
 */
export function TreasurerScreen() {
  const state = useChainState();
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!state) return <Loading />;
  const { treasury, employees } = state;
  const activeCount = employees.filter(
    (e) => e.commitment.status === EMPLOYMENT_STATUS_ACTIVE && e.commitment.nextPeriod <= e.commitment.endPeriod,
  ).length;

  const runOne = async (employeeNo: number): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const run = await chainGateway.runPayroll(employeeNo);
      setRuns((previous) => [run, ...previous]);
    } catch (thrown) {
      setError(errorMessage(thrown));
    } finally {
      setBusy(false);
    }
  };

  const runAll = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const collected: PayrollRun[] = [];
    const failures: string[] = [];
    for (const employee of employees) {
      try {
        collected.push(await chainGateway.runPayroll(employee.employeeNo));
      } catch (thrown) {
        failures.push(errorMessage(thrown));
      }
    }
    if (collected.length > 0) setRuns((previous) => [...collected.reverse(), ...previous]);
    if (failures.length > 0) setError(failures.join(' '));
    setBusy(false);
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2">
          <SectionTitle hint="Fungible ePHP (1 unit = 1 centavo) locked under the PayrollTreasury covenant.">
            ePHP treasury
          </SectionTitle>
          <p className="text-4xl font-bold tracking-tight text-flag-yellow">
            {formatPeso(treasury.ephpBalance)}
          </p>
          <p className="mt-1 font-mono text-sm text-slate-500">{formatEphp(treasury.ephpBalance)}</p>
          <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-500">Token category</dt>
              <dd className="font-mono text-slate-300">{truncateHex(treasury.tokenCategory, 12, 6)}</dd>
            </div>
            <div className="flex justify-between gap-2 sm:block">
              <dt className="text-slate-500">Covenant address</dt>
              <dd className="font-mono text-slate-300">{treasury.address}</dd>
            </div>
          </dl>
        </Card>
        <Card>
          <SectionTitle>This cut-off</SectionTitle>
          <dl className="space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-400">Payable employees</dt>
              <dd className="text-xl font-semibold text-slate-100">{activeCount}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-slate-400">Runs executed</dt>
              <dd className="text-xl font-semibold text-slate-100">{treasury.runCount}</dd>
            </div>
          </dl>
          <button
            type="button"
            disabled={busy || activeCount === 0}
            onClick={() => void runAll()}
            className="mt-4 w-full rounded-lg bg-flag-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Run All — permissionless, no signature
          </button>
        </Card>
      </div>

      <ErrorNote message={error} />

      <Card>
        <SectionTitle hint="Each row is a mutable employment NFT held by the EmploymentVault. Amounts are computed live by the same statutory engine the covenant is tested against.">
          Employee roster
        </SectionTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-2 pr-4 font-normal">Employee</th>
                <th className="py-2 pr-4 font-normal">Status</th>
                <th className="py-2 pr-4 font-normal">Period</th>
                <th className="py-2 pr-4 text-right font-normal">Monthly comp</th>
                <th className="py-2 pr-4 text-right font-normal">Net / cut-off</th>
                <th className="py-2 pr-4 text-right font-normal">Treasury draw</th>
                <th className="py-2 font-normal" />
              </tr>
            </thead>
            <tbody>
              {employees.map((employee) => {
                const c = employee.commitment;
                const d = computeDeductions({
                  monthlyBasic: c.monthlyBasic,
                  monthlyAllowance: c.monthlyAllowance,
                  taxPerPeriod: c.taxPerPeriod,
                });
                return (
                  <tr key={employee.employeeNo} className="border-t border-slate-800">
                    <td className="py-3 pr-4">
                      <p className="font-medium text-slate-100">{employee.name}</p>
                      <p className="text-xs text-slate-500">
                        {employee.position} · #{employee.employeeNo}
                      </p>
                    </td>
                    <td className="py-3 pr-4">
                      <StatusBadge commitment={c} />
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-slate-400">
                      {c.nextPeriod} / {c.endPeriod}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-slate-300">
                      {formatPeso(d.monthlyCompensation)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-slate-300">
                      {formatPeso(d.net)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-flag-yellow">
                      {formatPeso(d.totalDrawn)}
                    </td>
                    <td className="py-3 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runOne(employee.employeeNo)}
                        className="rounded-lg border border-flag-blue bg-flag-blue/20 px-3 py-1.5 text-xs font-semibold text-blue-200 transition hover:bg-flag-blue/40 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Run Payroll
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {runs.length > 0 ? (
        <div className="space-y-4">
          <SectionTitle hint="Net pay and every statutory remittance leave the treasury in one atomic transaction — the deduction and the remittance are the same event.">
            Disbursement transactions
          </SectionTitle>
          {runs.map((run) => (
            <OutputDiagram key={run.txid} run={run} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
