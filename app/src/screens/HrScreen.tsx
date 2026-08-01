import { useMemo, useState, type ReactNode } from 'react';

import {
  commitmentFromHex,
  commitmentToHex,
  encodeCommitment,
} from '@domain/payroll/commitment';
import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types';

import type { AmendResult, EmployeeRecord } from '../chain/gateway';
import { chainGateway } from '../chain/mock-chain-gateway';
import { errorMessage, useChainState } from '../chain/use-chain';
import { CommitmentHex } from '../components/CommitmentHex';
import { Card, ErrorNote, Loading, SectionTitle, StatusBadge } from '../components/ui';
import { bytesToHex, formatPeso, parsePesoInput } from '../lib/format';
import { useWallet } from '../wallet/paytaca';

/**
 * /hr — where employment records are born and amended. Issuance mints a
 * mutable NFT whose 40-byte commitment IS the employment contract; every
 * amendment is an HR-signed covenant path that rewrites those bytes, so each
 * action here shows the exact byte diff the chain will see.
 */
export function HrScreen() {
  const state = useChainState();
  const [lastAmend, setLastAmend] = useState<AmendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!state) return <Loading />;
  const { employees } = state;

  const applyAmend = async (
    employeeNo: number,
    action: Parameters<typeof chainGateway.amend>[1],
  ): Promise<void> => {
    setError(null);
    try {
      setLastAmend(await chainGateway.amend(employeeNo, action));
    } catch (thrown) {
      setError(errorMessage(thrown));
    }
  };

  return (
    <div className="space-y-6">
      <IssueForm nextEmployeeNo={1000 + employees.length + 1} />

      <ErrorNote message={error} />

      <Card>
        <SectionTitle hint="amend() is the only signed path in the system — HR's key rewrites the commitment, and the monotonic period counter can never move backwards.">
          Employment roster
        </SectionTitle>
        <div className="space-y-4">
          {employees.map((employee) => (
            <RosterRow
              key={employee.employeeNo}
              employee={employee}
              onAction={applyAmend}
            />
          ))}
        </div>
      </Card>

      {lastAmend ? <AmendDiff result={lastAmend} /> : null}
    </div>
  );
}

// ── Issue-employment form ────────────────────────────────────────────────

/** Stand-in payee PKH so the form demos end-to-end with no wallet connected. */
const DEMO_PKH = '7f3a1c5e9b0d2f4a6c8e0a1b3c5d7e9f0a1b3c5d';

type EncodeAttempt =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly problem: string };

function IssueForm(props: { nextEmployeeNo: number }) {
  const [name, setName] = useState('');
  const [position, setPosition] = useState('');
  const [basicText, setBasicText] = useState('18,000.00');
  const [allowanceText, setAllowanceText] = useState('0.00');
  const [taxText, setTaxText] = useState('0.00');
  const [endText, setEndText] = useState('24');
  const [issued, setIssued] = useState<string | null>(null);

  /**
   * The payee PKH follows the wallet the employee connected on their own
   * screen, until HR types over it. Storing only the override (rather than
   * syncing state in an effect) means the field can never go stale against the
   * wallet, and HR's own edit always wins.
   */
  const wallet = useWallet();
  const walletPkhHex = wallet.status === 'connected' ? wallet.account.pkhHex : null;
  const [pkhOverride, setPkhOverride] = useState<string | null>(null);
  const pkhText = pkhOverride ?? walletPkhHex ?? DEMO_PKH;
  const followingWallet = pkhOverride === null && walletPkhHex !== null;

  const attempt: EncodeAttempt = useMemo(() => {
    const basic = parsePesoInput(basicText);
    if (basic === null) return { ok: false, problem: 'Basic salary must be a peso amount.' };
    const allowance = parsePesoInput(allowanceText);
    if (allowance === null) return { ok: false, problem: 'Allowance must be a peso amount.' };
    const tax = parsePesoInput(taxText);
    if (tax === null) return { ok: false, problem: 'Withholding tax must be a peso amount.' };
    if (!/^[0-9a-fA-F]{40}$/.test(pkhText)) {
      return { ok: false, problem: 'Payee PKH must be exactly 40 hex characters (20 bytes).' };
    }
    const endPeriod = Number(endText);
    if (!Number.isInteger(endPeriod) || endPeriod < 1) {
      return { ok: false, problem: 'End period must be a positive whole number.' };
    }
    try {
      const bytes = encodeCommitment({
        payeePkh: commitmentFromHex(pkhText.toLowerCase()),
        monthlyBasic: basic,
        monthlyAllowance: allowance,
        taxPerPeriod: tax,
        nextPeriod: 1,
        endPeriod,
        status: EMPLOYMENT_STATUS_ACTIVE,
        employeeNo: props.nextEmployeeNo,
      });
      return { ok: true, hex: commitmentToHex(bytes) };
    } catch (thrown) {
      return { ok: false, problem: errorMessage(thrown) };
    }
  }, [basicText, allowanceText, taxText, pkhText, endText, props.nextEmployeeNo]);

  const issue = (): void => {
    if (!attempt.ok) return;
    const basic = parsePesoInput(basicText);
    const allowance = parsePesoInput(allowanceText);
    const tax = parsePesoInput(taxText);
    if (basic === null || allowance === null || tax === null) return;
    const record = chainGateway.issue({
      name: name || 'Unnamed Employee',
      position,
      payeePkh: commitmentFromHex(pkhText.toLowerCase()),
      monthlyBasic: basic,
      monthlyAllowance: allowance,
      taxPerPeriod: tax,
      endPeriod: Number(endText),
    });
    setIssued(`${record.name} issued as employee #${record.employeeNo} — NFT minted into the vault.`);
  };

  return (
    <Card>
      <SectionTitle hint="The form live-encodes the 40-byte NFT commitment — what you see below is byte-for-byte what the chain will carry.">
        Issue employment NFT
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          <Field label="Full name">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ana Reyes" className={inputClass} />
          </Field>
          <Field label="Position">
            <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="QA Engineer" className={inputClass} />
          </Field>
          <Field label="Monthly basic (₱)">
            <input value={basicText} onChange={(e) => setBasicText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Monthly allowance (₱)">
            <input value={allowanceText} onChange={(e) => setAllowanceText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Withholding tax / period (₱)">
            <input value={taxText} onChange={(e) => setTaxText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="End period (of 24 / year)">
            <input value={endText} onChange={(e) => setEndText(e.target.value)} className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Payee PKH (20-byte hex — the employee's wallet)">
              <input
                value={pkhText}
                onChange={(e) => setPkhOverride(e.target.value)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            {followingWallet ? (
              <p className="mt-1 text-xs text-emerald-300">
                Pre-filled from the Paytaca wallet connected on the Employee screen.
              </p>
            ) : null}
            {!followingWallet && walletPkhHex !== null ? (
              <button
                type="button"
                onClick={() => setPkhOverride(null)}
                className="mt-1 text-xs font-semibold text-blue-300 underline-offset-2 hover:underline"
              >
                Use the connected wallet’s PKH instead
              </button>
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <button
              type="button"
              disabled={!attempt.ok}
              onClick={issue}
              className="rounded-lg bg-flag-blue px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Issue as employee #{props.nextEmployeeNo}
            </button>
            {issued ? <p className="mt-2 text-xs text-emerald-300">{issued}</p> : null}
          </div>
        </div>
        <div>
          {attempt.ok ? (
            <CommitmentHex hex={attempt.hex} />
          ) : (
            <div className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-500">
              {attempt.problem}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ── Roster row with amend / suspend / separate ───────────────────────────

function RosterRow(props: {
  employee: EmployeeRecord;
  onAction: (employeeNo: number, action: Parameters<typeof chainGateway.amend>[1]) => Promise<void>;
}) {
  const { employee, onAction } = props;
  const c = employee.commitment;
  const [editing, setEditing] = useState(false);
  const [basicText, setBasicText] = useState('');
  const [allowanceText, setAllowanceText] = useState('');
  const [taxText, setTaxText] = useState('');

  const startEditing = (): void => {
    setBasicText(pesoInputValue(c.monthlyBasic));
    setAllowanceText(pesoInputValue(c.monthlyAllowance));
    setTaxText(pesoInputValue(c.taxPerPeriod));
    setEditing(true);
  };

  const applyTerms = (): void => {
    const monthlyBasic = parsePesoInput(basicText);
    const monthlyAllowance = parsePesoInput(allowanceText);
    const taxPerPeriod = parsePesoInput(taxText);
    if (monthlyBasic === null || monthlyAllowance === null || taxPerPeriod === null) return;
    void onAction(employee.employeeNo, { kind: 'terms', monthlyBasic, monthlyAllowance, taxPerPeriod });
    setEditing(false);
  };

  const active = c.status === EMPLOYMENT_STATUS_ACTIVE;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium text-slate-100">
            {employee.name} <span className="text-xs text-slate-500">#{employee.employeeNo}</span>
          </p>
          <p className="text-xs text-slate-500">
            {employee.position} · basic {formatPeso(c.monthlyBasic)} · allowance{' '}
            {formatPeso(c.monthlyAllowance)} · tax {formatPeso(c.taxPerPeriod)} · period{' '}
            {c.nextPeriod}/{c.endPeriod}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge commitment={c} />
          <button type="button" onClick={startEditing} className={actionClass}>
            Amend terms
          </button>
          {active ? (
            <button
              type="button"
              onClick={() => void onAction(employee.employeeNo, { kind: 'suspend' })}
              className={actionClass}
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void onAction(employee.employeeNo, { kind: 'reinstate' })}
              className={actionClass}
            >
              Reinstate
            </button>
          )}
          <button
            type="button"
            onClick={() => void onAction(employee.employeeNo, { kind: 'separate' })}
            className={`${actionClass} border-flag-red/50 text-red-300 hover:bg-flag-red/20`}
          >
            Separate
          </button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-900/70 p-3">
          <Field label="Monthly basic (₱)">
            <input value={basicText} onChange={(e) => setBasicText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Monthly allowance (₱)">
            <input value={allowanceText} onChange={(e) => setAllowanceText(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Tax / period (₱)">
            <input value={taxText} onChange={(e) => setTaxText(e.target.value)} className={inputClass} />
          </Field>
          <div className="flex gap-2">
            <button type="button" onClick={applyTerms} className={`${actionClass} border-emerald-500/50 text-emerald-300 hover:bg-emerald-500/20`}>
              Apply amendment
            </button>
            <button type="button" onClick={() => setEditing(false)} className={actionClass}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <CommitmentHex hex={employee.commitmentHex} showLegend={false} />
      </div>
    </div>
  );
}

// ── The commitment diff every action produces ────────────────────────────

function AmendDiff(props: { result: AmendResult }) {
  const { result } = props;
  const changes = describeChanges(result);

  return (
    <Card>
      <SectionTitle hint="Highlighted bytes are the ones HR's signature rewrote. Everything else is provably untouched.">
        Commitment diff — {result.action} on #{result.employeeNo}
      </SectionTitle>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className="mb-1 text-xs text-slate-500">before</p>
          <CommitmentHex hex={result.beforeHex} compareHex={result.afterHex} showLegend={false} />
          <p className="mt-3 mb-1 text-xs text-slate-500">after</p>
          <CommitmentHex hex={result.afterHex} compareHex={result.beforeHex} showLegend={false} />
        </div>
        <div>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-xs text-slate-500">
                <th className="py-1.5 pr-3 font-normal">field</th>
                <th className="py-1.5 pr-3 font-normal">before</th>
                <th className="py-1.5 font-normal">after</th>
              </tr>
            </thead>
            <tbody>
              {changes.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-2 text-slate-500">
                    No bytes changed.
                  </td>
                </tr>
              ) : (
                changes.map((change) => (
                  <tr key={change.field} className="border-t border-slate-800/60">
                    <td className="py-1.5 pr-3 font-mono text-slate-300">{change.field}</td>
                    <td className="py-1.5 pr-3 text-slate-400">{change.from}</td>
                    <td className="py-1.5 font-medium text-flag-yellow">{change.to}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

interface FieldChange {
  readonly field: string;
  readonly from: string;
  readonly to: string;
}

function describeChanges(result: AmendResult): FieldChange[] {
  const { before, after } = result;
  const changes: FieldChange[] = [];
  const push = (field: string, from: string, to: string): void => {
    if (from !== to) changes.push({ field, from, to });
  };

  push('payeePkh', bytesToHex(before.payeePkh), bytesToHex(after.payeePkh));
  push('monthlyBasic', formatPeso(before.monthlyBasic), formatPeso(after.monthlyBasic));
  push('monthlyAllowance', formatPeso(before.monthlyAllowance), formatPeso(after.monthlyAllowance));
  push('taxPerPeriod', formatPeso(before.taxPerPeriod), formatPeso(after.taxPerPeriod));
  push('nextPeriod', String(before.nextPeriod), String(after.nextPeriod));
  push('endPeriod', String(before.endPeriod), String(after.endPeriod));
  push(
    'status',
    before.status === 1 ? '1 · active' : '0 · inactive',
    after.status === 1 ? '1 · active' : '0 · inactive',
  );
  push('employeeNo', `#${before.employeeNo}`, `#${after.employeeNo}`);

  return changes;
}

// ── Small helpers ────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:border-flag-blue focus:outline-none';

const actionClass =
  'rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800';

function Field(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block text-xs text-slate-400 ${props.className ?? ''}`}>
      <span className="mb-1 block">{props.label}</span>
      {props.children}
    </label>
  );
}

/** Centavos → the text a peso input should show ("35000.00"). */
function pesoInputValue(centavos: bigint): string {
  return `${centavos / 100n}.${(centavos % 100n).toString().padStart(2, '0')}`;
}
