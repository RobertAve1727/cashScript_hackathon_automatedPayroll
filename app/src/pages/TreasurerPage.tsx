import { Fragment, useState } from 'react'

import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types'
import { computeDeductions } from '@domain/statutory/deductions'

import type { PayrollRun } from '../chain/gateway'
// Writes go through the ACTIVE gateway, not the mock.
//
// Importing `chainGateway` from mock-chain-gateway directly — which this file
// used to do — meant reads came from whichever chain was configured while
// writes always went to memory. On a chipnet build the treasury tile showed
// the real balance and "Run payroll" quietly mutated an in-memory copy, so the
// screen reported a payroll that had not happened.
import { activeGateway } from '../chain/active-gateway'
import { errorMessage, useChainState } from '../chain/use-chain'
import { formatPayday, payrollReadiness } from '../chain/readiness'
import { scheduleOf } from '../data/cadence-store'
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
export default function TreasurerPage() {
  const state = useChainState()
  const [runs, setRuns] = useState<PayrollRun[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const proofView = useProofView()

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
    try {
      const run = await activeGateway().runPayroll(employeeNo)
      setRuns((previous) => [run, ...previous])
    } catch (thrown) {
      setError(errorMessage(thrown))
    } finally {
      setBusy(false)
    }
  }

  const runAll = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const collected: PayrollRun[] = []
    const failures: string[] = []
    for (const employee of employees) {
      try {
        collected.push(await activeGateway().runPayroll(employee.employeeNo))
      } catch (thrown) {
        failures.push(errorMessage(thrown))
      }
    }
    if (collected.length > 0) setRuns((previous) => [...collected.reverse(), ...previous])
    if (failures.length > 0) setError(failures.join(' '))
    setBusy(false)
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
            <i className="ti ti-player-play me-1"></i>
            Run all — permissionless, no signature
          </button>
        </PageHeader>

        <ErrorNote message={error} />

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
                    const readiness = payrollReadiness(c, scheduleOf(employee.employeeNo))
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
                              Run payroll
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
