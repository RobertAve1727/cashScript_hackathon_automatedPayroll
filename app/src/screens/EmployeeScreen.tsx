import { useState, type ReactNode } from 'react';

import { computeDeductions, employerCost } from '@domain/statutory/deductions';

import { errorMessage, useChainState } from '../chain/use-chain';
import { Card, Loading, SectionTitle, StatusBadge } from '../components/ui';
import { formatPeso, formatWhen, truncateHex } from '../lib/format';

/**
 * /employee — the payslip. Every deduction line carries its legal basis, and
 * the footer reconciles employer cost against the treasury draw two different
 * ways — to the centavo, because both sides are integer arithmetic on chain.
 */
export function EmployeeScreen() {
  const state = useChainState();
  const [selectedNo, setSelectedNo] = useState<number | null>(null);

  if (!state) return <Loading />;
  const { employees } = state;
  const selected =
    employees.find((employee) => employee.employeeNo === selectedNo) ?? employees[0];
  if (!selected) return <p className="p-8 text-sm text-slate-500">No employment NFTs issued.</p>;

  const c = selected.commitment;
  let payslip: ReactNode;
  try {
    const d = computeDeductions({
      monthlyBasic: c.monthlyBasic,
      monthlyAllowance: c.monthlyAllowance,
      taxPerPeriod: c.taxPerPeriod,
    });
    const totalDeductions = d.sssEE + d.phicEE + d.hdmfEE + d.tax;
    const cost = employerCost(d);

    payslip = (
      <>
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <SectionTitle>Payslip — semi-monthly cut-off</SectionTitle>
              <p className="text-xl font-semibold text-slate-100">{selected.name}</p>
              <p className="text-sm text-slate-500">
                {selected.position} · Employee #{selected.employeeNo}
              </p>
            </div>
            <div className="text-right">
              <StatusBadge commitment={c} />
              <p className="mt-2 font-mono text-xs text-slate-500">
                next payable period{' '}
                <span className="text-fuchsia-300">{c.nextPeriod}</span> of {c.endPeriod}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-widest text-slate-500 uppercase">
                Earnings
              </h3>
              <Line label="Monthly basic salary" amount={c.monthlyBasic} />
              <Line label="Monthly allowance" amount={c.monthlyAllowance} />
              <Line label="Gross this cut-off (½ of monthly)" amount={d.gross} strong />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold tracking-widest text-slate-500 uppercase">
                Deductions — remitted in the same transaction
              </h3>
              <Line
                label="SSS employee share"
                basis={`RA 11199 · Social Security Act — MSC ${formatPeso(d.sssMsc)}`}
                amount={d.sssEE}
                negative
              />
              <Line
                label="PhilHealth employee share"
                basis="RA 11223 · Universal Health Care Act"
                amount={d.phicEE}
                negative
              />
              <Line
                label="Pag-IBIG employee share"
                basis="RA 9679 · HDMF Law"
                amount={d.hdmfEE}
                negative
              />
              <Line
                label="Withholding tax"
                basis="RA 10963 · TRAIN — HR-computed, covenant-enforced"
                amount={d.tax}
                negative
              />
              <Line label="Total deductions" amount={totalDeductions} negative strong />
            </div>
          </div>

          <div className="mt-6 flex items-baseline justify-between rounded-lg bg-flag-blue/15 px-4 py-3">
            <span className="text-sm font-semibold tracking-widest text-blue-200 uppercase">
              Net pay
            </span>
            <span className="text-3xl font-bold text-flag-yellow">{formatPeso(d.net)}</span>
          </div>

          <footer className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm">
                <p className="font-semibold text-emerald-300">
                  Reconciliation — employer cost equals treasury draw
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  gross {formatPeso(d.gross)} + SSS ER {formatPeso(d.sssER)} + EC{' '}
                  {formatPeso(d.sssEC)} + PhilHealth ER {formatPeso(d.phicER)} + Pag-IBIG ER{' '}
                  {formatPeso(d.hdmfER)}
                </p>
              </div>
              <div className="text-right">
                <p className="font-mono text-lg font-semibold text-slate-100">
                  {formatPeso(cost)} = {formatPeso(d.totalDrawn)}
                </p>
                <p className="text-xs font-medium text-emerald-300">
                  {cost === d.totalDrawn
                    ? '✓ reconciled to the centavo, computed two independent ways'
                    : '✗ MISMATCH — this should be impossible'}
                </p>
              </div>
            </div>
          </footer>
        </Card>

        <Card>
          <SectionTitle hint="Each entry is one on-chain transaction that paid the employee and remitted to SSS, PhilHealth, Pag-IBIG and BIR atomically.">
            Payment history
          </SectionTitle>
          {selected.history.length === 0 ? (
            <p className="text-sm text-slate-500">
              No disbursements yet — run payroll from the Treasurer screen.
            </p>
          ) : (
            <ul className="divide-y divide-slate-800 text-sm">
              {selected.history.map((run) => (
                <li key={run.txid} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div>
                    <p className="text-slate-200">
                      Period {run.period} · {formatWhen(run.executedAt)}
                    </p>
                    <p className="font-mono text-xs text-slate-500">{truncateHex(run.txid, 16, 8)}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-semibold text-flag-yellow">
                      {formatPeso(run.deductions.net)}
                    </p>
                    <p className="text-xs text-slate-500">
                      draw {formatPeso(run.deductions.totalDrawn)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </>
    );
  } catch (thrown) {
    payslip = (
      <Card>
        <p className="text-sm text-red-300">{errorMessage(thrown)}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        {employees.map((employee) => (
          <button
            key={employee.employeeNo}
            type="button"
            onClick={() => setSelectedNo(employee.employeeNo)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              employee.employeeNo === selected.employeeNo
                ? 'bg-flag-blue text-white'
                : 'border border-slate-700 text-slate-400 hover:bg-slate-800'
            }`}
          >
            {employee.name}
          </button>
        ))}
      </div>
      {payslip}
    </div>
  );
}

function Line(props: {
  label: string;
  amount: bigint;
  basis?: string;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-1.5 ${
        props.strong ? 'mt-1 border-t border-slate-700 pt-2' : ''
      }`}
    >
      <div className="min-w-0">
        <p className={`text-sm ${props.strong ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>
          {props.label}
        </p>
        {props.basis ? <p className="text-xs text-slate-500">{props.basis}</p> : null}
      </div>
      <p
        className={`shrink-0 font-mono text-sm ${
          props.strong ? 'font-semibold' : ''
        } ${props.negative ? 'text-rose-300' : 'text-slate-100'}`}
      >
        {props.negative ? `(${formatPeso(props.amount)})` : formatPeso(props.amount)}
      </p>
    </div>
  );
}
