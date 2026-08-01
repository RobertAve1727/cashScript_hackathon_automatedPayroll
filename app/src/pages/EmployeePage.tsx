import { Fragment, useState, type ReactNode } from 'react'

import { computeDeductions, employerCost } from '@domain/statutory/deductions'

import { errorMessage, useChainState } from '../chain/use-chain'
import { useSession } from '../auth/session'
import { Card, CardHeader, Loading, PageHeader, StatusBadge } from '../components/ui'
import { formatPeso, formatWhen, truncateHex } from '../lib/format'
import { cancelPaytaca, connectPaytaca, disconnectPaytaca, useWallet } from '../wallet/paytaca'

/**
 * /employee — onboarding, then the payslip.
 *
 * The wallet card is deliberately the *only* place a wallet appears in eSahod:
 * connecting hands us an address, we derive the 20-byte payee PKH from it, and
 * the employee passes that to HR. Nothing downstream needs the wallet again —
 * `paySalary` carries no signature, so payroll runs whether this card says
 * connected or not. Below it, every deduction line carries its legal basis and
 * the footer reconciles employer cost against the treasury draw two different
 * ways — to the centavo, because both sides are integer arithmetic on chain.
 */
export default function EmployeePage() {
  return (
    <div className="content">
      <PageHeader title="My Payslips" section="My Work" />
      <WalletCard />
      <PayslipSection />
    </div>
  )
}

function PayslipSection() {
  const state = useChainState()
  const user = useSession()

  if (!state) return <Loading />
  const { employees } = state
  // An employee sees their own record and only their own — the account is
  // bound to an employment NFT by number, so there is no picker to wander off.
  const selected = employees.find((employee) => employee.employeeNo === user?.employeeNo)
  if (!selected) {
    return (
      <Card>
        <div className="card-body text-muted">
          No employment record is linked to this account yet — HR issues it from Employment
          Records.
        </div>
      </Card>
    )
  }

  const c = selected.commitment
  let payslip: ReactNode
  try {
    const d = computeDeductions({
      monthlyBasic: c.monthlyBasic,
      monthlyAllowance: c.monthlyAllowance,
      taxPerPeriod: c.taxPerPeriod,
    })
    const totalDeductions = d.sssEE + d.phicEE + d.hdmfEE + d.tax
    const cost = employerCost(d)

    payslip = (
      <Fragment>
        <Card>
          <div className="card-header d-flex align-items-start justify-content-between flex-wrap row-gap-3">
            <div className="me-2">
              <p className="fs-12 mb-1 text-muted">Payslip — semi-monthly cut-off</p>
              <h5 className="mb-1">{selected.name}</h5>
              <p className="fs-12 mb-0 text-muted">
                {selected.position} · Employee #{selected.employeeNo}
              </p>
            </div>
            <div className="text-md-end">
              <StatusBadge commitment={c} />
              <p className="fs-12 mb-0 mt-2 font-monospace text-muted">
                next payable period <span className="text-purple">{c.nextPeriod}</span> of{' '}
                {c.endPeriod}
              </p>
            </div>
          </div>
          <div className="card-body">
            <div className="row g-4">
              <div className="col-lg-6">
                <h6 className="fs-12 text-uppercase text-muted mb-2">Earnings</h6>
                <Line label="Monthly basic salary" amount={c.monthlyBasic} />
                <Line label="Monthly allowance" amount={c.monthlyAllowance} />
                <Line label="Gross this cut-off (½ of monthly)" amount={d.gross} strong />
              </div>
              <div className="col-lg-6">
                <h6 className="fs-12 text-uppercase text-muted mb-2">
                  Deductions — remitted in the same transaction
                </h6>
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

            <div className="d-flex align-items-center justify-content-between bg-primary-transparent rounded p-3 mt-4">
              <span className="fs-13 fw-medium text-uppercase">Net pay</span>
              <h3 className="mb-0">{formatPeso(d.net)}</h3>
            </div>
          </div>
          <div className="card-footer">
            <div className="d-flex align-items-center justify-content-between flex-wrap row-gap-3">
              <div className="me-2">
                <p className="mb-1 fw-medium text-success">
                  Reconciliation — employer cost equals treasury draw
                </p>
                <p className="fs-12 mb-0 text-muted">
                  gross {formatPeso(d.gross)} + SSS ER {formatPeso(d.sssER)} + EC{' '}
                  {formatPeso(d.sssEC)} + PhilHealth ER {formatPeso(d.phicER)} + Pag-IBIG ER{' '}
                  {formatPeso(d.hdmfER)}
                </p>
              </div>
              <div className="text-md-end">
                <p className="mb-0 font-monospace fw-medium">
                  {formatPeso(cost)} = {formatPeso(d.totalDrawn)}
                </p>
                <p className={`fs-12 mb-0 ${cost === d.totalDrawn ? 'text-success' : 'text-danger'}`}>
                  {cost === d.totalDrawn
                    ? '✓ reconciled to the centavo, computed two independent ways'
                    : '✗ MISMATCH — this should be impossible'}
                </p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Payment history"
            hint="Each entry is one on-chain transaction that paid the employee and remitted to SSS, PhilHealth, Pag-IBIG and BIR atomically."
          />
          <div className="card-body p-0">
            {selected.history.length === 0 ? (
              <p className="text-muted p-3 mb-0">
                No disbursements yet — run payroll from the Treasury screen.
              </p>
            ) : (
              <ul className="list-group list-group-flush mb-0">
                {selected.history.map((run) => (
                  <li
                    key={run.txid}
                    className="list-group-item d-flex align-items-center justify-content-between flex-wrap row-gap-2"
                  >
                    <div className="me-2">
                      <p className="mb-0">
                        Period {run.period} · {formatWhen(run.executedAt)}
                      </p>
                      <p className="fs-12 mb-0 font-monospace text-muted">
                        {truncateHex(run.txid, 16, 8)}
                      </p>
                    </div>
                    <div className="text-end">
                      <p className="mb-0 font-monospace fw-medium">
                        {formatPeso(run.deductions.net)}
                      </p>
                      <p className="fs-12 mb-0 text-muted">
                        draw {formatPeso(run.deductions.totalDrawn)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </Fragment>
    )
  } catch (thrown) {
    payslip = (
      <Card>
        <div className="card-body text-danger">{errorMessage(thrown)}</div>
      </Card>
    )
  }

  return <Fragment>{payslip}</Fragment>
}

// ── Wallet onboarding ────────────────────────────────────────────────────

/**
 * Connect Paytaca → derive the payee PKH → hand it to HR. The card is fully
 * self-contained: with no `VITE_WC_PROJECT_ID` it renders an explanation and a
 * dead button, and the rest of the screen never notices.
 */
function WalletCard() {
  const wallet = useWallet()
  const [note, setNote] = useState<string | null>(null)

  const copy = (label: string, text: string): void => {
    void copyText(text).then((ok) => {
      setNote(
        ok ? `${label} copied.` : `Clipboard unavailable — select the ${label} and copy it manually.`,
      )
    })
  }

  return (
    <Card>
      <CardHeader
        title="Connect your wallet — onboarding"
        hint="Your wallet is only ever asked for an address. eSahod never asks it to sign a payroll transaction — the covenant does that, unsigned."
      >
        {wallet.status === 'connected' ? (
          <span className="badge badge-soft-success badge-sm fw-normal">
            <i className="ti ti-circle-filled fs-5 me-1"></i>Paytaca connected
          </span>
        ) : null}
      </CardHeader>
      <div className="card-body">
        {wallet.status === 'unconfigured' ? (
          <div className="d-flex align-items-center flex-wrap gap-3">
            <button type="button" className="btn btn-primary" disabled>
              <i className="ti ti-wallet me-1"></i>Connect Paytaca
            </button>
            <p className="fs-12 mb-0 text-warning">{wallet.detail}</p>
          </div>
        ) : null}

        {wallet.status === 'disconnected' ? (
          <div className="d-flex align-items-center flex-wrap gap-3">
            <button type="button" className="btn btn-primary" onClick={() => void connectPaytaca()}>
              <i className="ti ti-wallet me-1"></i>Connect Paytaca
            </button>
            <p className="fs-12 mb-0 text-muted">
              {wallet.detail ??
                'Pairs over WalletConnect v2 on the bch:bchtest namespace, then reads one address.'}
            </p>
          </div>
        ) : null}

        {wallet.status === 'connecting' ? (
          <Fragment>
            <div className="d-flex align-items-center flex-wrap gap-3 mb-3">
              <span className="d-inline-flex align-items-center">
                <span
                  className="spinner-border spinner-border-sm me-2"
                  role="status"
                  aria-hidden="true"
                ></span>
                {wallet.detail}
              </span>
              <button type="button" className="btn btn-sm btn-outline-light" onClick={cancelPaytaca}>
                Cancel
              </button>
            </div>
            {wallet.uri === null ? null : (
              <div className="border rounded p-3">
                <p className="fs-12 mb-2 text-muted">
                  Pairing URI — open it on this device, or paste it into Paytaca’s WalletConnect
                  scanner.
                </p>
                <p className="fs-12 mb-2 font-monospace text-break">{wallet.uri}</p>
                <div className="d-flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline-light"
                    onClick={() => copy('Pairing URI', wallet.uri ?? '')}
                  >
                    Copy pairing URI
                  </button>
                  <a className="btn btn-sm btn-outline-light" href={wallet.uri}>
                    Open in Paytaca
                  </a>
                </div>
              </div>
            )}
          </Fragment>
        ) : null}

        {wallet.status === 'connected' ? (
          <Fragment>
            <div className="row g-3 mb-3">
              <div className="col-sm-6">
                <div className="border rounded p-3 h-100">
                  <p className="fs-12 mb-1 text-muted">Address from Paytaca</p>
                  <p className="fs-12 mb-0 font-monospace text-break">{wallet.account.address}</p>
                </div>
              </div>
              <div className="col-sm-6">
                <div className="border rounded p-3 h-100 bg-primary-transparent">
                  <p className="fs-12 mb-1">
                    Decoded payee PKH — bytes 0–19 of the employment commitment
                  </p>
                  <p className="fs-12 mb-0 font-monospace text-break fw-medium">
                    {wallet.account.pkhHex}
                  </p>
                </div>
              </div>
            </div>
            <div className="d-flex align-items-center flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => copy('Payee PKH', wallet.account.pkhHex)}
              >
                <i className="ti ti-copy me-1"></i>Copy PKH for HR
              </button>
              <button
                type="button"
                className="btn btn-outline-light"
                onClick={() => void disconnectPaytaca()}
              >
                Disconnect
              </button>
              <p className="fs-12 mb-0 text-muted">
                Already pre-filled on the HR screen’s issuance form.
              </p>
            </div>
          </Fragment>
        ) : null}

        {note ? <p className="fs-12 mb-0 mt-3 text-success">{note}</p> : null}
      </div>
      <div className="card-footer fs-12 text-muted">
        Disconnect and run payroll anyway — <span className="font-monospace">paySalary</span> is
        signature-free, so nobody, wallet or not, holds the button.
      </div>
    </Card>
  )
}

/** Best-effort clipboard write — false when the browser refuses (http, focus). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function Line(props: {
  label: string
  amount: bigint
  basis?: string
  negative?: boolean
  strong?: boolean
}) {
  return (
    <div
      className={`d-flex align-items-baseline justify-content-between gap-3 py-1 ${
        props.strong ? 'border-top mt-1 pt-2' : ''
      }`}
    >
      <div className="overflow-hidden">
        <p className={`mb-0 ${props.strong ? 'fw-medium' : ''}`}>{props.label}</p>
        {props.basis ? <p className="fs-12 mb-0 text-muted">{props.basis}</p> : null}
      </div>
      <p
        className={`mb-0 flex-shrink-0 font-monospace ${props.strong ? 'fw-medium' : ''} ${
          props.negative ? 'text-danger' : ''
        }`}
      >
        {props.negative ? `(${formatPeso(props.amount)})` : formatPeso(props.amount)}
      </p>
    </div>
  )
}
