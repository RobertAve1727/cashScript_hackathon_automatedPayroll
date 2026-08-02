import type { ReactNode } from 'react'

import { commitmentFromHex, decodeCommitment } from '@domain/payroll/commitment'
import { COMMITMENT_LAYOUT } from '@domain/payroll/types'
import type { EmploymentCommitment } from '@domain/payroll/commitment'

import { bytesToHex, formatPeso } from '../lib/format'

/**
 * The 40-byte employment commitment, rendered the way it actually sits inside
 * the NFT: 80 hex characters, segmented by field, with a byte-offset legend.
 * When `compareHex` is given, bytes that differ are highlighted — this is the
 * "commitment diff" every HR action shows.
 *
 * Field colours are the design system's contextual text colours, so the hex
 * strip stays legible in both the light and dark themes.
 */

interface FieldMeta {
  readonly key: keyof typeof COMMITMENT_LAYOUT
  readonly label: string
  readonly colorClass: string
  readonly describe: (record: EmploymentCommitment) => string
}

const FIELDS: readonly FieldMeta[] = [
  {
    key: 'payeePkh',
    label: 'payeePkh',
    colorClass: 'text-info',
    describe: (r) => `wallet hash ${bytesToHex(r.payeePkh).slice(0, 12)}…`,
  },
  {
    key: 'monthlyBasic',
    label: 'monthlyBasic',
    colorClass: 'text-success',
    describe: (r) => formatPeso(r.monthlyBasic),
  },
  {
    key: 'monthlyAllowance',
    label: 'monthlyAllowance',
    colorClass: 'text-teal',
    describe: (r) => formatPeso(r.monthlyAllowance),
  },
  {
    key: 'taxPerPeriod',
    label: 'taxPerPeriod',
    colorClass: 'text-warning',
    describe: (r) => formatPeso(r.taxPerPeriod),
  },
  {
    key: 'nextPeriod',
    label: 'nextPeriod',
    colorClass: 'text-pink',
    describe: (r) => `period ${r.nextPeriod}`,
  },
  {
    key: 'endPeriod',
    label: 'endPeriod',
    colorClass: 'text-purple',
    describe: (r) => `until ${r.endPeriod}`,
  },
  {
    key: 'status',
    label: 'status',
    colorClass: 'text-danger',
    describe: (r) => (r.status === 1 ? '1 · active' : '0 · inactive'),
  },
  {
    key: 'employeeNo',
    label: 'employeeNo',
    colorClass: 'text-secondary',
    describe: (r) => `#${r.employeeNo}`,
  },
]

interface CommitmentHexProps {
  /** 80 hex characters — a full 40-byte commitment. */
  readonly hex: string
  /** Previous commitment; differing bytes get highlighted. */
  readonly compareHex?: string
  readonly showLegend?: boolean
}

export function CommitmentHex({ hex, compareHex, showLegend = true }: CommitmentHexProps) {
  const record = decodeCommitment(commitmentFromHex(hex))

  return (
    <div>
      <div className="border rounded p-3 font-monospace fs-13 lh-lg text-break">
        {FIELDS.map((field) => {
          const layout = COMMITMENT_LAYOUT[field.key]
          const pairs: ReactNode[] = []
          for (let byte = 0; byte < layout.bytes; byte += 1) {
            const at = (layout.offset + byte) * 2
            const pair = hex.slice(at, at + 2)
            const changed = compareHex !== undefined && compareHex.slice(at, at + 2) !== pair
            pairs.push(
              <span
                key={byte}
                className={changed ? 'bg-warning-transparent text-warning fw-bold rounded-1' : undefined}
              >
                {pair}
              </span>,
            )
          }
          return (
            <span key={field.key} className={`${field.colorClass} me-2 text-nowrap`}>
              {pairs}
            </span>
          )
        })}
      </div>

      {showLegend ? (
        <div className="table-responsive mt-2">
          <table className="table table-sm table-nowrap mb-0">
            <thead className="table-light">
              <tr>
                <th>bytes</th>
                <th>field</th>
                <th>value</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map((field) => {
                const layout = COMMITMENT_LAYOUT[field.key]
                const end = layout.offset + layout.bytes - 1
                return (
                  <tr key={field.key}>
                    <td className="font-monospace text-muted">
                      {layout.offset === end ? layout.offset : `${layout.offset}–${end}`}
                    </td>
                    <td className={`font-monospace ${field.colorClass}`}>{field.label}</td>
                    <td>{field.describe(record)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  )
}
