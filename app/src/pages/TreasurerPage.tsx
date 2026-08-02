import { Fragment, useState } from 'react'

import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types'
import { computeDeductions } from '@domain/statutory/deductions'

import type { PayrollRun, RunStage } from '../chain/gateway'
// Writes go through the ACTIVE gateway, not the mock.
//
// Importing `chainGateway` from mock-chain-gateway directly — which this file
// used to do — meant reads came from whichever chain was configured while
// writes always went to memory. On a chipnet build the treasury tile showed
// the real balance and "Run payroll" quietly mutated an in-memory copy, so the
// screen reported a payroll that had not happened.
import { activeGateway } from '../chain/active-gateway'
import { errorMessage, useChainState } from '../chain/use-chain'
import {
  cadenceMatchesTreasury,
  deployedPeriodsPerMonth,
  formatPayday,
  payrollReadiness,
} from '../chain/readiness'
import { scheduleOf, useCadences } from '../data/cadence-store'
import { EmployeeAvatar } from '../components/EmployeeAvatar'
import { OutputDiagram } from '../components/OutputDiagram'
import { Card, CardHeader, ErrorNote, Loading, PageHeader, StatTile, StatusBadge } from '../components/ui'
import { formatEphp, formatPeso, truncateHex } from '../lib/format'
import { useProofView } from '../view/proof-view'

/**
 * /treasurer — the payroll officer's console. The role is deliberately
 * powerless: the Run buttons trigger disbursement but cannot redirect a
 * centavo, because every payee is enforced by the covenant.
 */
/**
 * What each stage means, in the operator's terms rather than the adapter's.
 *
 * Deliberately not a percentage. There is no honest denominator — a broadcast
 * takes as long as the network takes — and a bar that creeps to 90% and stops
 * is a worse lie than no bar at all.
 */
const STAGE_LABEL: Readonly<Record<RunStage, string>> = {
  reading: 'Reading the chain…',
  building: 'Building the transaction…',
  broadcasting: 'Broadcasting…',
  confirming: 'Confirming…',
}

const STAGE_DETAIL: Readonly<Record<RunStage, string>> = {
  reading: 'Fetching the treasury balance and this employee’s record from chipnet.',
  building: 'Assembling the seven outputs the covenant will check.',
  broadcasting:
    'The keeper is signing the fee input and sending the transaction. Every payee and amount is already fixed — this step cannot change them.',
  confirming: 'Re-reading the chain so the figures below are the chain’s, not a prediction.',
}

const STAGES: readonly RunStage[] = ['reading', 'building', 'broadcasting', 'confirming']

export default function TreasurerPage() {
  const state = useChainState()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /**
   * Which employee is being paid, and how far it has got. Broadcasting to a
   * real chain takes seconds; a disabled button alone leaves an operator unable
   * to tell a slow network from a wedged one, which is the difference between
   * waiting and refreshing the page mid-broadcast.
   */
  const [running, setRunning] = useState<{ employeeNo: number | 'all'; stage: RunStage } | null>(
    null,
  )
  const proofView = useProofView()
  // Loads every employee's cadence; without it scheduleOf answers from an
  // empty cache and reports the default for the whole roster.
  useCadences()

  if (!state) return <Loading />
  const { treasury, employees } = state
  // "Payable" used to mean active and inside the contract window, with no clock
  // at all — so it counted employees whose payday had not arrived and whose
  // transaction the covenant would refuse. It now asks the same question the
  // covenant asks.
  const activeCount = employees.filter(
    (e) => payrollReadiness(e.commitment, scheduleOf(e.employeeNo)).due,
  ).length

  const runOne = async (employeeNo: number): Promise<void> => {
    setBusy(true)
    setError(null)
    setRunning({ employeeNo, stage: 'reading' })
    try {
      const run = await activeGateway().runPayroll(employeeNo, (stage) =>
        setRunning({ employeeNo, stage }),
      )
      setRuns((previous) => [run, ...previous])
    } catch (thrown) {
      setError(errorMessage(thrown))
    } finally {
      setBusy(false)
      setRunning(null)
    }
  }

  const runAll = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const collected: PayrollRun[] = []
    const failures: string[] = []

    // Only the ones actually due. "Run all" used to mean every employee on the
    // roster, so a record whose payday had not arrived was built, signed,
    // broadcast and refused by the network with "bad-txns-nonfinal" — the
    // covenant's locktime working exactly as designed, arriving as a wall of
    // node error text. The roster row already knows better; this now asks the
    // same question before spending a fee on a transaction that cannot confirm.
    const due = employees.filter(
      (employee) => payrollReadiness(employee.commitment, scheduleOf(employee.employeeNo)).due,
    )

    for (const employee of due) {
      try {
        setRunning({ employeeNo: 'all', stage: 'reading' })
        collected.push(
          await activeGateway().runPayroll(employee.employeeNo, (stage) =>
            setRunning({ employeeNo: 'all', stage }),
          ),
        )
      } catch (thrown) {
        failures.push(errorMessage(thrown))
      }
    }
    if (collected.length > 0) setRuns((previous) => [...collected.reverse(), ...previous])
    if (failures.length > 0) setError(failures.join(' '))
    if (due.length === 0) {
      setError(
        'Nobody is due yet. The covenant refuses a period before its payday, so there is nothing to broadcast.',
      )
    }
    setBusy(false)
    setRunning(null)
  }

  return (
    <Fragment>
      <div className="content">
        <PageHeader title="Treasury" section="Payroll">
          <button
            type="button"
            className="btn btn-primary d-flex align-items-center"
            disabled={busy || activeCount === 0}
            onClick={() => void runAll()}
          >
            {running?.employeeNo === 'all' ? (
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
            ) : (
              <i className="ti ti-player-play me-1"></i>
            )}
            {running?.employeeNo === 'all'
              ? STAGE_LABEL[running.stage]
              : 'Run all — permissionless, no signature'}
          </button>
        </PageHeader>

        <ErrorNote message={error} />

        {/*
          Shown while a run is in flight. Not a modal: a modal would block the
          roster the operator is watching change, and there is nothing here for
          them to decide — only something to wait for.
        */}
        {running ? (
          <Card>
            <div className="card-body">
              <div className="d-flex align-items-center mb-3">
                <span className="spinner-border spinner-border-sm text-primary me-3" role="status">
                  <span className="visually-hidden">Working</span>
                </span>
                <div>
                  <h6 className="mb-0">
                    {STAGE_LABEL[running.stage]}{' '}
                    <span className="text-muted fw-normal fs-13">
                      {running.employeeNo === 'all'
                        ? '— every payable employee'
                        : `— employee #${running.employeeNo}`}
                    </span>
                  </h6>
                  <p className="fs-12 text-muted mb-0">{STAGE_DETAIL[running.stage]}</p>
                </div>
              </div>

              <div className="d-flex gap-2">
                {STAGES.map((stage) => {
                  const at = STAGES.indexOf(running.stage)
                  const index = STAGES.indexOf(stage)

                  return (
                    <div
                      key={stage}
                      className={`flex-fill rounded ${
                        index < at ? 'bg-success' : index === at ? 'bg-primary' : 'bg-light'
                      }`}
                      style={{ height: 4 }}
                      title={STAGE_LABEL[stage]}
                    ></div>
                  )
                })}
              </div>
              <p className="fs-12 text-muted mb-0 mt-2">
                This is a real broadcast to chipnet and takes a few seconds. Leaving the page will
                not stop it — the transaction is the chain’s once it is sent.
              </p>
            </div>
          </Card>
        ) : null}

        <div className="row">
          <div className="col-xl-6 col-md-12 d-flex">
            <Card className="flex-fill">
              <CardHeader
                title="ePHP treasury"
                hint="Fungible ePHP (1 unit = 1 centavo) locked under the PayrollTreasury covenant."
              />
              <div className="card-body">
                <h1 className="mb-1">{formatPeso(treasury.ephpBalance)}</h1>
                {proofView ? (
                  <p className="fs-13 text-muted mb-4 font-monospace">
                    {formatEphp(treasury.ephpBalance)}
                  </p>
                ) : (
                  <p className="fs-13 text-muted mb-4">Funded for this payroll cycle</p>
                )}
                <div className="row g-3">
                  {proofView ? (
                    <div className="col-sm-6">
                      <p className="fs-12 mb-1 text-muted">Token category</p>
                      <p className="mb-0 font-monospace fs-13 text-truncate">
                        {truncateHex(treasury.tokenCategory, 12, 6)}
                      </p>
                    </div>
                  ) : null}
                  <div className={proofView ? 'col-sm-6' : 'col-12'}>
                    <p className="fs-12 mb-1 text-muted">Covenant address</p>
                    <p className="mb-0 font-monospace fs-13 text-truncate">{treasury.address}</p>
                  </div>
                </div>
              </div>
            </Card>
          </div>
          <div className="col-xl-3 col-md-6 d-flex">
            <div className="flex-fill">
              <StatTile
                label="Payable employees"
                value={activeCount}
                sub="Due now — the covenant would accept it"
                icon="ti ti-users-group"
                tone="success"
              />
            </div>
          </div>
          <div className="col-xl-3 col-md-6 d-flex">
            <div className="flex-fill">
              <StatTile
                label="Runs executed"
                value={treasury.runCount}
                sub="Disbursement transactions broadcast"
                icon="ti ti-receipt"
                tone="info"
              />
            </div>
          </div>
        </div>

        <Card>
          <CardHeader
            title="Employee roster"
            hint="Each row is a mutable employment NFT held by the EmploymentVault. Amounts are computed live by the same statutory engine the covenant is tested against."
          />
          <div className="card-body p-0">
            <div className="table-responsive">
              <table className="table table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Employee</th>
                    <th>Status</th>
                    <th>Period</th>
                    <th className="text-end">Monthly comp</th>
                    <th className="text-end">Net / cut-off</th>
                    <th className="text-end">Treasury draw</th>
                    <th className="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  {employees.map((employee) => {
                    const c = employee.commitment
                    const d = computeDeductions({
                      monthlyBasic: c.monthlyBasic,
                      monthlyAllowance: c.monthlyAllowance,
                      taxPerPeriod: c.taxPerPeriod,
                    })
                    const schedule = scheduleOf(employee.employeeNo)
                    const readiness = payrollReadiness(c, schedule)
                    return (
                      <tr key={employee.employeeNo}>
                        <td>
                          <div className="d-flex align-items-center">
                            <EmployeeAvatar name={employee.name} employeeNo={employee.employeeNo} />
                            <div className="ms-2 overflow-hidden">
                              <h6 className="fw-medium mb-0">{employee.name}</h6>
                              <span className="fs-12 text-muted">
                                {employee.position} · #{employee.employeeNo}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <StatusBadge commitment={c} />
                        </td>
                        <td className="font-monospace fs-13">
                          {c.nextPeriod} / {c.endPeriod}
                          {/*
                            Says why a weekly employee and a semi-monthly one
                            share a payday. They are paid by the same treasury,
                            because only one is deployed — without this the
                            cadence setting looks ignored rather than unfunded.
                          */}
                          {cadenceMatchesTreasury(schedule) ? null : (
                            <span
                              className="d-block fs-12 text-warning"
                              title={`This employee is set to ${schedule.cadence} (${schedule.periodsPerMonth} periods a month), but the deployed treasury settles ${deployedPeriodsPerMonth()} a month. Paying them ${schedule.cadence} on chain needs a treasury deployed for that cadence.`}
                            >
                              set {schedule.cadence} · paid by the{' '}
                              {deployedPeriodsPerMonth() === 2 ? 'semi-monthly' : 'deployed'} treasury
                            </span>
                          )}
                        </td>
                        <td className="text-end font-monospace">{formatPeso(d.monthlyCompensation)}</td>
                        <td className="text-end font-monospace">{formatPeso(d.net)}</td>
                        <td className="text-end font-monospace fw-medium">
                          {formatPeso(d.totalDrawn)}
                        </td>
                        <td className="text-end">
                          {/*
                            Gated on the covenant's OWN rule, not on a separate
                            opinion: `tx.time >= genesisTime + period *
                            periodSeconds`. Offering the button early would
                            offer a transaction the chain is going to reject,
                            and the rejection would arrive as a covenant error
                            in front of whoever is watching.
                          */}
                          {readiness.due ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              disabled={busy}
                              onClick={() => void runOne(employee.employeeNo)}
                            >
                              {running?.employeeNo === employee.employeeNo ? (
                                <Fragment>
                                  <span
                                    className="spinner-border spinner-border-sm me-2"
                                    role="status"
                                    aria-hidden="true"
                                  ></span>
                                  {STAGE_LABEL[running.stage]}
                                </Fragment>
                              ) : (
                                'Run payroll'
                              )}
                            </button>
                          ) : (
                            <span
                              className="badge badge-soft-secondary fw-normal"
                              title={readiness.detail}
                            >
                              {readiness.reason === 'not-yet'
                                ? `Due ${formatPayday(readiness.nextPaydayAt)}`
                                : readiness.reason === 'window-exhausted'
                                  ? 'Contract ended'
                                  : 'Not active'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </Card>

        {runs.length > 0 ? (
          <Fragment>
            <div className="mb-3">
              <h5 className="mb-1">Disbursement transactions</h5>
              <p className="fs-13 text-muted mb-0">
                Net pay and every statutory remittance leave the treasury in one atomic
                transaction — the deduction and the remittance are the same event.
              </p>
            </div>
            {runs.map((run) => (
              <OutputDiagram key={run.txid} run={run} />
            ))}
          </Fragment>
        ) : null}
      </div>
    </Fragment>
  )
}
