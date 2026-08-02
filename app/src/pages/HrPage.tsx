import { Fragment, useMemo, useState, type ReactNode } from 'react'

import { commitmentFromHex, commitmentToHex, encodeCommitment } from '@domain/payroll/commitment'
import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types'

import type { AmendResult, EmployeeRecord } from '../chain/gateway'
import { chainGateway } from '../chain/mock-chain-gateway'
import { errorMessage, useChainState } from '../chain/use-chain'
import { CommitmentHex } from '../components/CommitmentHex'
import { EmployeeAvatar } from '../components/EmployeeAvatar'
import { Card, CardHeader, ErrorNote, Loading, PageHeader, StatusBadge } from '../components/ui'
import { bytesToHex, formatPeso, parsePesoInput } from '../lib/format'
import { useWallet } from '../wallet/paytaca'
import { useProofView } from '../view/proof-view'

/**
 * /hr — where employment records are born and amended. Issuance mints a
 * mutable NFT whose 40-byte commitment IS the employment contract; every
 * amendment is an HR-signed covenant path that rewrites those bytes, so each
 * action here shows the exact byte diff the chain will see.
 */
export default function HrPage() {
  const state = useChainState()
  const [lastAmend, setLastAmend] = useState<AmendResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const proofView = useProofView()

  if (!state) return <Loading />
  const { employees } = state

  const applyAmend = async (
    employeeNo: number,
    action: Parameters<typeof chainGateway.amend>[1],
  ): Promise<void> => {
    setError(null)
    try {
      setLastAmend(await chainGateway.amend(employeeNo, action))
    } catch (thrown) {
      setError(errorMessage(thrown))
    }
  }

  return (
    <div className="content">
      <PageHeader title="Employment Records" section="Human Resources">
        <button
          type="button"
          className="btn btn-primary d-flex align-items-center"
          data-bs-target="#issue_employment"
          data-bs-toggle="modal"
        >
          <i className="ti ti-circle-plus me-2"></i>
          Issue employment NFT
        </button>
      </PageHeader>

      <ErrorNote message={error} />

      {issued ? (
        <div className="alert alert-success d-flex align-items-center" role="alert">
          <i className="ti ti-circle-check me-2"></i>
          <span>{issued}</span>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Employment roster"
          hint={
            proofView
              ? "amend() is the only signed path in the system — HR's key rewrites the commitment, and the monotonic period counter can never move backwards."
              : 'Changing a record takes HR’s key and is recorded on the chain. A pay period that has been paid can never be reopened.'
          }
        />
        <div className="card-body">
          {employees.map((employee) => (
            <RosterRow key={employee.employeeNo} employee={employee} onAction={applyAmend} />
          ))}
        </div>
      </Card>

      {lastAmend ? <AmendDiff result={lastAmend} /> : null}

      {/*
        The dialog lives at the end of the page rather than beside its trigger:
        Bootstrap moves an open modal's backdrop to the end of <body>, and a
        modal nested inside a positioned ancestor can end up rendered behind it.
      */}
      <IssueForm nextEmployeeNo={1000 + employees.length + 1} onIssued={setIssued} />
    </div>
  )
}

// ── Issue-employment form ────────────────────────────────────────────────

/** Stand-in payee PKH so the form demos end-to-end with no wallet connected. */
const DEMO_PKH = '7f3a1c5e9b0d2f4a6c8e0a1b3c5d7e9f0a1b3c5d'

type EncodeAttempt =
  | { readonly ok: true; readonly hex: string }
  | { readonly ok: false; readonly problem: string }

function IssueForm(props: { nextEmployeeNo: number; onIssued: (message: string) => void }) {
  const [firstName, setFirstName] = useState('')
  const [middleName, setMiddleName] = useState('')
  const [lastName, setLastName] = useState('')
  const [position, setPosition] = useState('')
  // Which name fields the user has actually left. A form that opens already
  // red is telling someone off for something they have not done yet, so the
  // invalid styling waits for a blur.
  const [touched, setTouched] = useState<{ first: boolean; last: boolean }>({
    first: false,
    last: false,
  })
  const [basicText, setBasicText] = useState('18,000.00')
  const [allowanceText, setAllowanceText] = useState('0.00')
  const [taxText, setTaxText] = useState('0.00')
  const [endText, setEndText] = useState('24')

  /**
   * The payee PKH follows the wallet the employee connected on their own
   * screen, until HR types over it. Storing only the override (rather than
   * syncing state in an effect) means the field can never go stale against the
   * wallet, and HR's own edit always wins.
   */
  const proofView = useProofView()
  const wallet = useWallet()
  const walletPkhHex = wallet.status === 'connected' ? wallet.account.pkhHex : null
  const [pkhOverride, setPkhOverride] = useState<string | null>(null)
  const pkhText = pkhOverride ?? walletPkhHex ?? DEMO_PKH
  const followingWallet = pkhOverride === null && walletPkhHex !== null

  /**
   * Whether the name is complete. Deliberately SEPARATE from the encoding
   * below, because the 40-byte commitment has no name field — it carries the
   * payee hash, the pay figures, the period counters, the status and the
   * employee number, and nothing else. A missing name is a reason not to
   * issue the record; it is not a reason the bytes cannot be computed, and
   * blanking the preview over it conflated two different questions.
   */
  const nameProblem =
    firstName.trim() === ''
      ? 'First name is required.'
      : lastName.trim() === ''
        ? 'Last name is required.'
        : null

  const attempt: EncodeAttempt = useMemo(() => {
    const basic = parsePesoInput(basicText)
    if (basic === null) return { ok: false, problem: 'Basic salary must be a peso amount.' }
    const allowance = parsePesoInput(allowanceText)
    if (allowance === null) return { ok: false, problem: 'Allowance must be a peso amount.' }
    const tax = parsePesoInput(taxText)
    if (tax === null) return { ok: false, problem: 'Withholding tax must be a peso amount.' }
    if (!/^[0-9a-fA-F]{40}$/.test(pkhText)) {
      return { ok: false, problem: 'Payee PKH must be exactly 40 hex characters (20 bytes).' }
    }
    const endPeriod = Number(endText)
    if (!Number.isInteger(endPeriod) || endPeriod < 1) {
      return { ok: false, problem: 'End period must be a positive whole number.' }
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
      })
      return { ok: true, hex: commitmentToHex(bytes) }
    } catch (thrown) {
      return { ok: false, problem: errorMessage(thrown) }
    }
  }, [basicText, allowanceText, taxText, pkhText, endText, props.nextEmployeeNo])

  const issue = (): void => {
    if (!attempt.ok || nameProblem !== null) return
    const basic = parsePesoInput(basicText)
    const allowance = parsePesoInput(allowanceText)
    const tax = parsePesoInput(taxText)
    if (basic === null || allowance === null || tax === null) return
    const record = chainGateway.issue({
      name: [firstName.trim(), middleName.trim(), lastName.trim()].filter(Boolean).join(' '),
      position,
      payeePkh: commitmentFromHex(pkhText.toLowerCase()),
      monthlyBasic: basic,
      monthlyAllowance: allowance,
      taxPerPeriod: tax,
      endPeriod: Number(endText),
    })
    props.onIssued(
      `${record.name} issued as employee #${record.employeeNo} — NFT minted into the vault.`,
    )

    // Clear the identifying fields so reopening the dialog starts a new hire
    // rather than re-offering the last one. The pay figures stay, because the
    // next hire is usually on similar terms and retyping them is the tedium
    // this screen exists to remove.
    setFirstName('')
    setMiddleName('')
    setLastName('')
    setPosition('')
    setTouched({ first: false, last: false })
  }

  return (
    <div
      aria-hidden="true"
      aria-labelledby="issue_employment_label"
      className="modal fade"
      id="issue_employment"
      role="dialog"
      tabIndex={-1}
    >
      <div className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable">
        <div className="modal-content">
          <div className="modal-header">
            <div className="me-2">
              <h4 className="modal-title" id="issue_employment_label">
                Issue employment NFT
              </h4>
              <p className="fs-12 mb-0 text-muted">
                The form live-encodes the 40-byte NFT commitment — what you see beside it is
                byte-for-byte what the chain will carry.
              </p>
            </div>
            <button aria-label="Close" className="btn-close" data-bs-dismiss="modal" type="button">
              <i className="ti ti-circle-x"></i>
            </button>
          </div>
          <div className="modal-body">
            <div className="row g-4">
              <div className="col-xl-7">
                <div className="row g-3">
              <div className="col-md-4">
                <Field label="First name *">
                  <input
                    className={`form-control ${touched.first && firstName.trim() === '' ? 'is-invalid' : ''}`}
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, first: true }))}
                    placeholder="Ana"
                    required
                  />
                  {touched.first && firstName.trim() === '' ? (
                    <div className="invalid-feedback d-block fs-12">First name is required.</div>
                  ) : null}
                </Field>
              </div>
              <div className="col-md-4">
                {/* Optional, and present because every PH statutory form asks
                    for it — SSS R-1A, PhilHealth ER2, BIR 2316. */}
                <Field label="Middle name">
                  <input
                    className="form-control"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    placeholder="Bautista"
                  />
                </Field>
              </div>
              <div className="col-md-4">
                <Field label="Last name *">
                  <input
                    className={`form-control ${touched.last && lastName.trim() === '' ? 'is-invalid' : ''}`}
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, last: true }))}
                    placeholder="Reyes"
                    required
                  />
                  {touched.last && lastName.trim() === '' ? (
                    <div className="invalid-feedback d-block fs-12">Last name is required.</div>
                  ) : null}
                </Field>
              </div>
              <div className="col-md-6">
                <Field label="Position">
                  <input
                    className="form-control"
                    value={position}
                    onChange={(e) => setPosition(e.target.value)}
                    placeholder="QA Engineer"
                  />
                </Field>
              </div>
              <div className="col-md-6">
                <Field label="Monthly basic (₱)">
                  <input
                    className="form-control"
                    value={basicText}
                    onChange={(e) => setBasicText(e.target.value)}
                  />
                </Field>
              </div>
              <div className="col-md-6">
                <Field label="Monthly allowance (₱)">
                  <input
                    className="form-control"
                    value={allowanceText}
                    onChange={(e) => setAllowanceText(e.target.value)}
                  />
                </Field>
              </div>
              <div className="col-md-6">
                <Field label="Withholding tax / period (₱)">
                  <input
                    className="form-control"
                    value={taxText}
                    onChange={(e) => setTaxText(e.target.value)}
                  />
                </Field>
              </div>
              <div className="col-md-6">
                <Field label="End period (of 24 / year)">
                  <input
                    className="form-control"
                    value={endText}
                    onChange={(e) => setEndText(e.target.value)}
                  />
                </Field>
              </div>
              <div className="col-12">
                <Field label="Payee PKH (20-byte hex — the employee's wallet)">
                  <input
                    className="form-control font-monospace"
                    value={pkhText}
                    onChange={(e) => setPkhOverride(e.target.value)}
                  />
                </Field>
                {followingWallet ? (
                  <p className="fs-12 mb-0 mt-1 text-success">
                    <i className="ti ti-wallet me-1"></i>
                    Pre-filled from the Paytaca wallet connected on the Employee screen.
                  </p>
                ) : null}
                {!followingWallet && walletPkhHex !== null ? (
                  <button
                    type="button"
                    className="btn btn-link btn-sm p-0 mt-1 fs-12"
                    onClick={() => setPkhOverride(null)}
                  >
                    Use the connected wallet’s PKH instead
                  </button>
                ) : null}
              </div>
                </div>
              </div>
              <div className="col-xl-5">
                {/*
                  Same panel, two audiences. With proof view on it is the live
                  40-byte encoding — the claim that this form writes the chain
                  directly. With it off it is what HR is about to commit to,
                  in words, which is what someone issuing a contract needs to
                  check before pressing the button.
                */}
                {!attempt.ok ? (
                  <div className="alert alert-warning mb-0" role="alert">
                    {attempt.problem}
                  </div>
                ) : proofView ? (
                  <>
                    <CommitmentHex hex={attempt.hex} />
                    {nameProblem ? <PendingName problem={nameProblem} /> : null}
                  </>
                ) : (
                  <>
                  {nameProblem ? <PendingName problem={nameProblem} /> : null}
                  <IssueReview
                    firstName={firstName}
                    middleName={middleName}
                    lastName={lastName}
                    position={position}
                    basicText={basicText}
                    allowanceText={allowanceText}
                    taxText={taxText}
                    endText={endText}
                    employeeNo={props.nextEmployeeNo}
                  />
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-light" data-bs-dismiss="modal">
              Cancel
            </button>
            {/*
              Bootstrap's own `data-bs-dismiss` closes the dialog and the click
              handler runs alongside it. Nothing here reaches for the Modal
              instance, so React and the plugin never contend over the backdrop
              — the failure that leaves a page permanently dimmed and unclickable.
            */}
            <button
              type="button"
              className="btn btn-primary"
              disabled={!attempt.ok || nameProblem !== null}
              data-bs-dismiss="modal"
              onClick={issue}
            >
              <i className="ti ti-plus me-1"></i>
              Issue as employee #{props.nextEmployeeNo}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Why the record cannot be issued yet, shown beside the preview rather than
 * instead of it. The bytes below are correct and computable — the commitment
 * has no name field — so hiding them over a missing name would answer a
 * question nobody asked.
 */
function PendingName({ problem }: { problem: string }) {
  return (
    <div className="alert alert-light border d-flex align-items-center fs-12 mb-2" role="status">
      <i className="ti ti-info-circle me-2"></i>
      <span>{problem} The bytes are ready; the name is not part of them, but the record is not issuable without one.</span>
    </div>
  )
}

/** What is about to be committed, in words — the proof-view-off counterpart. */
function IssueReview(props: {
  firstName: string
  middleName: string
  lastName: string
  position: string
  basicText: string
  allowanceText: string
  taxText: string
  endText: string
  employeeNo: number
}) {
  const rows: readonly [string, string][] = [
    [
      'Employee',
      [props.firstName, props.middleName, props.lastName]
        .map((part) => part.trim())
        .filter(Boolean)
        .join(' ') || 'Not yet named',
    ],
    ['Position', props.position.trim() === '' ? '—' : props.position],
    ['Employee number', `#${props.employeeNo}`],
    ['Monthly basic', `₱${props.basicText}`],
    ['Monthly allowance', `₱${props.allowanceText}`],
    ['Withholding tax / period', `₱${props.taxText}`],
    ['Paid through period', `${props.endText} of 24`],
  ]

  return (
    <div className="border rounded p-3 h-100">
      <h6 className="mb-1">Review</h6>
      <p className="fs-12 text-muted mb-3">
        Issuing writes this to the chain as the employee&rsquo;s record. Terms can be amended later
        with HR&rsquo;s key; the pay-period counter can never be moved backwards.
      </p>
      <dl className="mb-0">
        {rows.map(([label, value]) => (
          <div className="d-flex justify-content-between border-bottom py-2" key={label}>
            <dt className="fs-12 fw-normal text-muted">{label}</dt>
            <dd className="fs-13 fw-medium mb-0 text-end">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

// ── Roster row with amend / suspend / separate ───────────────────────────

function RosterRow(props: {
  employee: EmployeeRecord
  onAction: (employeeNo: number, action: Parameters<typeof chainGateway.amend>[1]) => Promise<void>
}) {
  const { employee, onAction } = props
  const c = employee.commitment
  const proofView = useProofView()
  const [editing, setEditing] = useState(false)
  const [basicText, setBasicText] = useState('')
  const [allowanceText, setAllowanceText] = useState('')
  const [taxText, setTaxText] = useState('')

  const startEditing = (): void => {
    setBasicText(pesoInputValue(c.monthlyBasic))
    setAllowanceText(pesoInputValue(c.monthlyAllowance))
    setTaxText(pesoInputValue(c.taxPerPeriod))
    setEditing(true)
  }

  const applyTerms = (): void => {
    const monthlyBasic = parsePesoInput(basicText)
    const monthlyAllowance = parsePesoInput(allowanceText)
    const taxPerPeriod = parsePesoInput(taxText)
    if (monthlyBasic === null || monthlyAllowance === null || taxPerPeriod === null) return
    void onAction(employee.employeeNo, {
      kind: 'terms',
      monthlyBasic,
      monthlyAllowance,
      taxPerPeriod,
    })
    setEditing(false)
  }

  const active = c.status === EMPLOYMENT_STATUS_ACTIVE

  return (
    <div className="border rounded p-3 mb-3">
      <div className="d-flex align-items-center justify-content-between flex-wrap row-gap-3">
        <div className="d-flex align-items-center me-2">
          <EmployeeAvatar name={employee.name} employeeNo={employee.employeeNo} size="lg" />
          <div className="ms-2 overflow-hidden">
          <h6 className="mb-1">
            {employee.name} <span className="fs-12 text-muted">#{employee.employeeNo}</span>
          </h6>
          <p className="fs-12 mb-0 text-muted">
            {employee.position} · basic {formatPeso(c.monthlyBasic)} · allowance{' '}
            {formatPeso(c.monthlyAllowance)} · tax {formatPeso(c.taxPerPeriod)} · period{' '}
            {c.nextPeriod}/{c.endPeriod}
          </p>
          </div>
        </div>
        <div className="d-flex align-items-center flex-wrap gap-2">
          <StatusBadge commitment={c} />
          <button type="button" className="btn btn-sm btn-outline-light" onClick={startEditing}>
            Amend terms
          </button>
          {active ? (
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={() => void onAction(employee.employeeNo, { kind: 'suspend' })}
            >
              Suspend
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={() => void onAction(employee.employeeNo, { kind: 'reinstate' })}
            >
              Reinstate
            </button>
          )}
          <button
            type="button"
            className="btn btn-sm btn-outline-danger"
            onClick={() => void onAction(employee.employeeNo, { kind: 'separate' })}
          >
            Separate
          </button>
        </div>
      </div>

      {editing ? (
        <div className="row g-3 align-items-end bg-light rounded p-3 mt-1">
          <div className="col-md-3">
            <Field label="Monthly basic (₱)">
              <input
                className="form-control"
                value={basicText}
                onChange={(e) => setBasicText(e.target.value)}
              />
            </Field>
          </div>
          <div className="col-md-3">
            <Field label="Monthly allowance (₱)">
              <input
                className="form-control"
                value={allowanceText}
                onChange={(e) => setAllowanceText(e.target.value)}
              />
            </Field>
          </div>
          <div className="col-md-3">
            <Field label="Tax / period (₱)">
              <input
                className="form-control"
                value={taxText}
                onChange={(e) => setTaxText(e.target.value)}
              />
            </Field>
          </div>
          <div className="col-md-3 d-flex gap-2">
            <button type="button" className="btn btn-sm btn-primary" onClick={applyTerms}>
              Apply amendment
            </button>
            <button
              type="button"
              className="btn btn-sm btn-outline-light"
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {/*
        The commitment restates, in hex, every field already printed in words
        on the row above it. That is proof when someone is checking the record
        really is on chain, and noise when someone is running payroll.
      */}
      {proofView ? (
        <div className="mt-3">
          <CommitmentHex hex={employee.commitmentHex} showLegend={false} />
        </div>
      ) : null}
    </div>
  )
}

// ── The commitment diff every action produces ────────────────────────────

function AmendDiff(props: { result: AmendResult }) {
  const { result } = props
  const changes = describeChanges(result)
  const proofView = useProofView()

  return (
    <Card>
      <CardHeader
        title={
          <Fragment>
            What changed — {result.action} on #{result.employeeNo}
          </Fragment>
        }
        hint={
          proofView
            ? "Highlighted bytes are the ones HR's signature rewrote. Everything else is provably untouched."
            : 'Every field HR’s signature rewrote. Anything not listed here was not touched.'
        }
      />
      <div className="card-body">
        <div className="row g-4">
          {/*
            The byte strips are the strongest evidence in the app — they show
            not just what changed but that nothing else did. They are still
            proof rather than payroll, so they follow the switch; the field
            table beside them says the same thing in words and always shows.
          */}
          {proofView ? (
            <div className="col-xl-6">
              <p className="fs-12 mb-1 text-muted">before</p>
              <CommitmentHex hex={result.beforeHex} compareHex={result.afterHex} showLegend={false} />
              <p className="fs-12 mb-1 mt-3 text-muted">after</p>
              <CommitmentHex hex={result.afterHex} compareHex={result.beforeHex} showLegend={false} />
            </div>
          ) : null}
          <div className={proofView ? 'col-xl-6' : 'col-12'}>
            <div className="table-responsive">
              <table className="table table-sm table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>field</th>
                    <th>before</th>
                    <th>after</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="text-muted">
                        No bytes changed.
                      </td>
                    </tr>
                  ) : (
                    changes.map((change) => (
                      <tr key={change.field}>
                        <td className="font-monospace">{change.field}</td>
                        <td className="text-muted">{change.from}</td>
                        <td className="fw-medium text-warning">{change.to}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

interface FieldChange {
  readonly field: string
  readonly from: string
  readonly to: string
}

function describeChanges(result: AmendResult): FieldChange[] {
  const { before, after } = result
  const changes: FieldChange[] = []
  const push = (field: string, from: string, to: string): void => {
    if (from !== to) changes.push({ field, from, to })
  }

  push('payeePkh', bytesToHex(before.payeePkh), bytesToHex(after.payeePkh))
  push('monthlyBasic', formatPeso(before.monthlyBasic), formatPeso(after.monthlyBasic))
  push('monthlyAllowance', formatPeso(before.monthlyAllowance), formatPeso(after.monthlyAllowance))
  push('taxPerPeriod', formatPeso(before.taxPerPeriod), formatPeso(after.taxPerPeriod))
  push('nextPeriod', String(before.nextPeriod), String(after.nextPeriod))
  push('endPeriod', String(before.endPeriod), String(after.endPeriod))
  push(
    'status',
    before.status === 1 ? '1 · active' : '0 · inactive',
    after.status === 1 ? '1 · active' : '0 · inactive',
  )
  push('employeeNo', `#${before.employeeNo}`, `#${after.employeeNo}`)

  return changes
}

// ── Small helpers ────────────────────────────────────────────────────────

function Field(props: { label: string; children: ReactNode }) {
  return (
    <div className="mb-0">
      <label className="form-label fs-12 mb-1">{props.label}</label>
      {props.children}
    </div>
  )
}

/** Centavos → the text a peso input should show ("35000.00"). */
function pesoInputValue(centavos: bigint): string {
  return `${centavos / 100n}.${(centavos % 100n).toString().padStart(2, '0')}`
}
