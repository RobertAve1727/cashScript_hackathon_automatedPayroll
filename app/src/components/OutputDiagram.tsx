import type { ReactNode } from 'react'

import type { PayrollRun, TxOutput } from '../chain/gateway'
import { formatEphp, formatPeso, formatWhen, truncateHex } from '../lib/format'

/**
 * THE seven-output diagram, live: one payroll transaction, rendered in the
 * exact order the covenant enforces. The deduction and the remittance are the
 * same atomic event — this component is that claim, drawn.
 *
 * Each output is colour-coded by the design system's own contextual colours,
 * carried on a left border so the eye can group the statutory remittances
 * apart from the employee's net pay.
 */

const KIND_TONE: Record<TxOutput['kind'], string> = {
  net: 'success',
  sss: 'info',
  philhealth: 'danger',
  pagibig: 'warning',
  bir: 'purple',
  nft: 'primary',
  change: 'secondary',
}

export function OutputDiagram(props: { run: PayrollRun }) {
  const { run } = props

  const rows: ReactNode[] = []
  for (const output of run.outputs) {
    if (run.layout.bir === null && output.index === run.layout.employmentNft) {
      rows.push(
        <li key="bir-omitted" className="list-group-item border-dashed fs-12 text-muted">
          <span className="fw-medium">BIR output omitted</span> — withholding tax is ₱0.00 and a
          zero-amount CashToken output is invalid, so the output does not exist and the NFT +
          change outputs shift up by one.
        </li>,
      )
    }
    rows.push(<OutputRow key={output.index} output={output} />)
  }

  return (
    <div className="card">
      <div className="card-header d-flex align-items-center justify-content-between flex-wrap row-gap-3">
        <div className="me-2">
          <h6 className="mb-1">
            Payroll tx — {run.employeeName}, period {run.period}
          </h6>
          <p className="fs-12 mb-0 font-monospace text-muted">
            {truncateHex(run.txid, 16, 8)} · {formatWhen(run.executedAt)}
          </p>
        </div>
        <div className="text-md-end">
          <p className="fs-12 mb-1 text-muted">Treasury draw</p>
          <h6 className="mb-0">{formatPeso(run.deductions.totalDrawn)}</h6>
        </div>
      </div>
      <div className="card-body p-0">
        <ol className="list-group list-group-flush mb-0">{rows}</ol>
      </div>
      <div className="card-footer d-sm-flex align-items-center justify-content-between fs-12 text-muted">
        <span>
          Treasury {formatPeso(run.treasuryBefore)} → {formatPeso(run.treasuryAfter)} — no
          signature ran this; the covenant only permits this exact shape.
        </span>
        <span>+ optional BCH change outputs</span>
      </div>
    </div>
  )
}

function OutputRow(props: { output: TxOutput }) {
  const { output } = props
  const tone = KIND_TONE[output.kind]

  return (
    <li className={`list-group-item d-flex align-items-center gap-3 border-start border-3 border-${tone}`}>
      <span
        className={`avatar avatar-xs bg-${tone}-transparent rounded-circle flex-shrink-0 fs-12 font-monospace`}
      >
        {output.index}
      </span>
      <div className="flex-fill overflow-hidden">
        <p className="mb-0 text-truncate">{output.label}</p>
        <p className="fs-12 mb-0 font-monospace text-muted text-truncate">
          {output.recipient}
          {output.detail ? <span> · {output.detail}</span> : null}
        </p>
      </div>
      <div className="text-end flex-shrink-0">
        {output.ephp === null ? (
          <span className="badge badge-soft-primary badge-sm fw-normal">mutable NFT</span>
        ) : (
          <>
            <p className="mb-0 fw-medium">{formatPeso(output.ephp)}</p>
            <p className="fs-12 mb-0 font-monospace text-muted">{formatEphp(output.ephp)}</p>
          </>
        )}
      </div>
    </li>
  )
}
