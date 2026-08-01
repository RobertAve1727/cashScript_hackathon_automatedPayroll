import type { ReactNode } from 'react';

import type { PayrollRun, TxOutput } from '../chain/gateway';
import { formatEphp, formatPeso, formatWhen, truncateHex } from '../lib/format';

/**
 * THE seven-output diagram, live: one payroll transaction, rendered in the
 * exact order the covenant enforces. The deduction and the remittance are the
 * same atomic event — this component is that claim, drawn.
 */

const KIND_ACCENT: Record<TxOutput['kind'], string> = {
  net: 'border-l-flag-yellow',
  sss: 'border-l-sky-400',
  philhealth: 'border-l-rose-400',
  pagibig: 'border-l-amber-400',
  bir: 'border-l-flag-red',
  nft: 'border-l-violet-400',
  change: 'border-l-slate-500',
};

export function OutputDiagram(props: { run: PayrollRun }) {
  const { run } = props;

  const rows: ReactNode[] = [];
  for (const output of run.outputs) {
    if (run.layout.bir === null && output.index === run.layout.employmentNft) {
      rows.push(
        <li
          key="bir-omitted"
          className="rounded-lg border border-dashed border-slate-700 px-4 py-2.5 text-xs text-slate-500"
        >
          <span className="font-semibold text-slate-400">BIR output omitted</span> — withholding
          tax is ₱0.00 and a zero-amount CashToken output is invalid, so the output does not
          exist and the NFT + change outputs shift up by one.
        </li>,
      );
    }
    rows.push(<OutputRow key={output.index} output={output} />);
  }

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-100">
            Payroll tx — {run.employeeName}, period {run.period}
          </h3>
          <p className="font-mono text-xs text-slate-500">
            {truncateHex(run.txid, 16, 8)} · {formatWhen(run.executedAt)}
          </p>
        </div>
        <p className="text-sm text-slate-300">
          treasury draw{' '}
          <span className="font-semibold text-flag-yellow">
            {formatPeso(run.deductions.totalDrawn)}
          </span>
        </p>
      </header>

      <ol className="space-y-1.5">{rows}</ol>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-500">
        <span>
          Treasury {formatPeso(run.treasuryBefore)} → {formatPeso(run.treasuryAfter)} — no
          signature ran this; the covenant only permits this exact shape.
        </span>
        <span>+ optional BCH change outputs</span>
      </footer>
    </div>
  );
}

function OutputRow(props: { output: TxOutput }) {
  const { output } = props;

  return (
    <li
      className={`flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 border-l-4 ${KIND_ACCENT[output.kind]}`}
    >
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-800 font-mono text-xs text-slate-300">
        {output.index}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-200">{output.label}</p>
        <p className="truncate font-mono text-xs text-slate-500">
          {output.recipient}
          {output.detail ? (
            <span className="text-slate-600"> · {output.detail}</span>
          ) : null}
        </p>
      </div>
      <div className="shrink-0 text-right">
        {output.ephp === null ? (
          <p className="text-sm font-medium text-violet-300">mutable NFT</p>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-100">{formatPeso(output.ephp)}</p>
            <p className="font-mono text-xs text-slate-500">{formatEphp(output.ephp)}</p>
          </>
        )}
      </div>
    </li>
  );
}
