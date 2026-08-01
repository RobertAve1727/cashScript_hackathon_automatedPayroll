import type { ReactNode } from 'react';

import { commitmentFromHex, decodeCommitment } from '@domain/payroll/commitment';
import { COMMITMENT_LAYOUT } from '@domain/payroll/types';
import type { EmploymentCommitment } from '@domain/payroll/commitment';

import { bytesToHex, formatPeso } from '../lib/format';

/**
 * The 40-byte employment commitment, rendered the way it actually sits inside
 * the NFT: 80 hex characters, segmented by field, with a byte-offset legend.
 * When `compareHex` is given, bytes that differ are highlighted — this is the
 * "commitment diff" every HR action shows.
 */

interface FieldMeta {
  readonly key: keyof typeof COMMITMENT_LAYOUT;
  readonly label: string;
  readonly colorClass: string;
  readonly describe: (record: EmploymentCommitment) => string;
}

const FIELDS: readonly FieldMeta[] = [
  {
    key: 'payeePkh',
    label: 'payeePkh',
    colorClass: 'text-sky-300',
    describe: (r) => `wallet hash ${bytesToHex(r.payeePkh).slice(0, 12)}…`,
  },
  {
    key: 'monthlyBasic',
    label: 'monthlyBasic',
    colorClass: 'text-emerald-300',
    describe: (r) => formatPeso(r.monthlyBasic),
  },
  {
    key: 'monthlyAllowance',
    label: 'monthlyAllowance',
    colorClass: 'text-teal-300',
    describe: (r) => formatPeso(r.monthlyAllowance),
  },
  {
    key: 'taxPerPeriod',
    label: 'taxPerPeriod',
    colorClass: 'text-amber-300',
    describe: (r) => formatPeso(r.taxPerPeriod),
  },
  {
    key: 'nextPeriod',
    label: 'nextPeriod',
    colorClass: 'text-fuchsia-300',
    describe: (r) => `period ${r.nextPeriod}`,
  },
  {
    key: 'endPeriod',
    label: 'endPeriod',
    colorClass: 'text-violet-300',
    describe: (r) => `until ${r.endPeriod}`,
  },
  {
    key: 'status',
    label: 'status',
    colorClass: 'text-rose-300',
    describe: (r) => (r.status === 1 ? '1 · active' : '0 · inactive'),
  },
  {
    key: 'employeeNo',
    label: 'employeeNo',
    colorClass: 'text-slate-300',
    describe: (r) => `#${r.employeeNo}`,
  },
];

interface CommitmentHexProps {
  /** 80 hex characters — a full 40-byte commitment. */
  readonly hex: string;
  /** Previous commitment; differing bytes get highlighted. */
  readonly compareHex?: string;
  readonly showLegend?: boolean;
}

export function CommitmentHex({ hex, compareHex, showLegend = true }: CommitmentHexProps) {
  const record = decodeCommitment(commitmentFromHex(hex));

  return (
    <div>
      <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 font-mono text-xs leading-6 break-all">
        {FIELDS.map((field) => {
          const layout = COMMITMENT_LAYOUT[field.key];
          const pairs: ReactNode[] = [];
          for (let byte = 0; byte < layout.bytes; byte += 1) {
            const at = (layout.offset + byte) * 2;
            const pair = hex.slice(at, at + 2);
            const changed =
              compareHex !== undefined && compareHex.slice(at, at + 2) !== pair;
            pairs.push(
              <span
                key={byte}
                className={
                  changed
                    ? 'rounded-sm bg-flag-yellow/25 text-flag-yellow underline decoration-flag-yellow/60 underline-offset-2'
                    : undefined
                }
              >
                {pair}
              </span>,
            );
          }
          return (
            <span key={field.key} className={`${field.colorClass} mr-2 whitespace-nowrap`}>
              {pairs}
            </span>
          );
        })}
      </div>

      {showLegend ? (
        <table className="mt-2 w-full text-left text-xs">
          <thead>
            <tr className="text-slate-500">
              <th className="py-1 pr-3 font-normal">bytes</th>
              <th className="py-1 pr-3 font-normal">field</th>
              <th className="py-1 font-normal">value</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((field) => {
              const layout = COMMITMENT_LAYOUT[field.key];
              const end = layout.offset + layout.bytes - 1;
              return (
                <tr key={field.key} className="border-t border-slate-800/60">
                  <td className="py-1 pr-3 font-mono text-slate-500">
                    {layout.offset === end ? layout.offset : `${layout.offset}–${end}`}
                  </td>
                  <td className={`py-1 pr-3 font-mono ${field.colorClass}`}>{field.label}</td>
                  <td className="py-1 text-slate-300">{field.describe(record)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
