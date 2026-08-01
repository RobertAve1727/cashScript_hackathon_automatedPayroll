import { Fragment, useState } from 'react'
import {
  MONTHLY_UNLAWFUL,
  SELECTABLE_SCHEDULES,
  SEMI_MONTHLY,
  monthlyObligations,
  scheduleMonth,
  type PayrollSchedule,
} from '@domain/index'
import { useChainState } from '../chain/use-chain'
import { Card, CardHeader, Loading, PageHeader } from '../components/ui'
import { formatPeso } from '../lib/format'
import { useProofView } from '../view/proof-view'

/**
 * /hr/schedule — choose how often the company pays, and see the arithmetic
 * hold.
 *
 * This page exists because "pay daily" is the easy half of the promise. The
 * hard half is that SSS, PhilHealth and Pag-IBIG publish MONTHLY brackets, and
 * whatever cadence a company picks, what reaches each agency at the end of the
 * month has to be that bracket exactly. Divide ₱1,750.00 across 22 working days
 * the obvious way and the month closes ₱0.12 short — every month, for every
 * employee, of money already withheld from a payslip.
 *
 * So the reconciliation is not a footnote here, it is the page: pick a cadence,
 * read down the column, and the total is the published figure.
 */
export default function PaySchedulePage() {
  const state = useChainState()
  const [schedule, setSchedule] = useState<PayrollSchedule>(SEMI_MONTHLY)
  const [employeeNo, setEmployeeNo] = useState<number | null>(null)
  const proofView = useProofView()

  if (!state) return <Loading />

  const employee =
    state.employees.find((candidate) => candidate.employeeNo === employeeNo) ?? state.employees[0]
  if (!employee) {
    return (
      <div className="content">
        <PageHeader title="Pay Schedule" section="Human Resources" />
        <Card>
          <div className="card-body text-muted">No employment records to schedule.</div>
        </Card>
      </div>
    )
  }

  const monthlyTax = employee.commitment.taxPerPeriod * 2n
  const monthly = monthlyObligations(
    employee.commitment.monthlyBasic,
    employee.commitment.monthlyAllowance,
  )
  const periods = scheduleMonth({
    monthlyBasic: employee.commitment.monthlyBasic,
    monthlyAllowance: employee.commitment.monthlyAllowance,
    monthlyTax,
    schedule,
  })

  const total = (pick: (period: (typeof periods)[number]) => bigint): bigint =>
    periods.reduce((sum, period) => sum + pick(period), 0n)

  const checks: readonly { label: string; remitted: bigint; published: bigint }[] = [
    { label: 'SSS — employee share', remitted: total((p) => p.sssEE), published: monthly.sssEE },
    { label: 'SSS — employer share', remitted: total((p) => p.sssER), published: monthly.sssER },
    { label: 'SSS — EC premium', remitted: total((p) => p.sssEC), published: monthly.sssEC },
    { label: 'PhilHealth — employee', remitted: total((p) => p.phicEE), published: monthly.phicEE },
    { label: 'PhilHealth — employer', remitted: total((p) => p.phicER), published: monthly.phicER },
    { label: 'Pag-IBIG — employee', remitted: total((p) => p.hdmfEE), published: monthly.hdmfEE },
    { label: 'Pag-IBIG — employer', remitted: total((p) => p.hdmfER), published: monthly.hdmfER },
    { label: 'BIR — withholding tax', remitted: total((p) => p.tax), published: monthlyTax },
    { label: 'Gross wage', remitted: total((p) => p.gross), published: monthly.monthlyCompensation },
  ]

  const allExact = checks.every((check) => check.remitted === check.published)

  return (
    <div className="content">
      <PageHeader title="Pay Schedule" section="Human Resources" />

      <div className="row">
        <div className="col-xl-8">
          <Card>
            <CardHeader
              title="Cadence"
              hint="Article 103 sets a floor, not a fixed cadence: wages at least twice a month, at intervals not exceeding 16 days. Anything more frequent is lawful."
            />
            <div className="card-body">
              <div className="row g-3">
                {SELECTABLE_SCHEDULES.map((option) => (
                  <div className="col-md-4" key={option.cadence}>
                    <button
                      type="button"
                      className={`card mb-0 w-100 h-100 text-start border ${
                        option.cadence === schedule.cadence ? 'border-primary' : ''
                      }`}
                      onClick={() => setSchedule(option)}
                    >
                      <div className="card-body">
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <h6 className="mb-0 text-capitalize">{option.cadence}</h6>
                          {option.cadence === schedule.cadence ? (
                            <i className="ti ti-circle-check-filled text-primary"></i>
                          ) : null}
                        </div>
                        <p className="fs-12 mb-2 text-muted">
                          {option.periodsPerMonth} pay periods a month
                        </p>
                        {/*
                          `text-wrap` and `d-inline-block`: these labels are
                          longer than the card is wide at the md breakpoint,
                          and a Bootstrap badge is nowrap by default, so
                          without this the text is clipped mid-word.
                        */}
                        {option.settledByDeployedCovenant ? (
                          <span className="badge badge-soft-success badge-sm fw-normal text-wrap d-inline-block text-start lh-sm">
                            Settled by the deployed covenant
                          </span>
                        ) : (
                          <span className="badge badge-soft-warning badge-sm fw-normal text-wrap d-inline-block text-start lh-sm">
                            Engine-ready — needs a covenant redeploy
                          </span>
                        )}
                      </div>
                    </button>
                  </div>
                ))}
              </div>

              <div className="alert alert-light border mt-3 mb-0 fs-12">
                <i className="ti ti-info-circle me-1"></i>
                {MONTHLY_UNLAWFUL.label}.{' '}
                {proofView ? (
                  <Fragment>
                    And the honest note on the badges above: the deployed covenant hardcodes the
                    semi-monthly divisor — <code>msc * 5 / 200</code> and{' '}
                    <code>gross = monthlyCompensation / 2</code>. Its <code>periodSeconds</code>{' '}
                    parameter controls only when a period becomes claimable, so switching cadence on
                    chain is a redeploy with two changed constants, not a flag. The engine below
                    already computes every cadence exactly.
                  </Fragment>
                ) : (
                  'The figures below are exact at every cadence; only semi-monthly is settled on chain today.'
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="col-xl-4">
          <Card>
            <CardHeader title="Employee" hint="Figures below are this record's, live." />
            <div className="card-body">
              <select
                className="form-select mb-3"
                value={employee.employeeNo}
                onChange={(event) => setEmployeeNo(Number(event.target.value))}
              >
                {state.employees.map((candidate) => (
                  <option key={candidate.employeeNo} value={candidate.employeeNo}>
                    {candidate.name} — #{candidate.employeeNo}
                  </option>
                ))}
              </select>
              <p className="fs-12 mb-1 text-muted">Monthly compensation</p>
              <h4 className="mb-3">{formatPeso(monthly.monthlyCompensation)}</h4>
              <p className="fs-12 mb-1 text-muted">SSS monthly salary credit</p>
              <h6 className="mb-0">{formatPeso(monthly.sssMsc)}</h6>
            </div>
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader
          title={`Month-end reconciliation — ${schedule.periodsPerMonth} ${
            schedule.periodsPerMonth === 1 ? 'period' : 'periods'
          }`}
          hint="What the agencies receive across the month, against what they published. These must be equal, not close."
        >
          <span
            className={`badge badge-sm fw-normal ${
              allExact ? 'badge-soft-success' : 'badge-soft-danger'
            }`}
          >
            {allExact ? 'Exact — every fund closes on its bracket' : 'MISMATCH'}
          </span>
        </CardHeader>
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-nowrap mb-0">
              <thead className="table-light">
                <tr>
                  <th>Obligation</th>
                  <th className="text-end">Remitted across the month</th>
                  <th className="text-end">Published monthly figure</th>
                  <th className="text-end">Difference</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((check) => (
                  <tr key={check.label}>
                    <td>{check.label}</td>
                    <td className="text-end font-monospace">{formatPeso(check.remitted)}</td>
                    <td className="text-end font-monospace">{formatPeso(check.published)}</td>
                    <td className="text-end font-monospace">
                      {check.remitted === check.published ? (
                        <span className="text-success">
                          <i className="ti ti-check me-1"></i>0.00
                        </span>
                      ) : (
                        <span className="text-danger">
                          {formatPeso(check.remitted - check.published)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Period by period"
          hint="The indivisible centavo lands on a real period instead of being dropped — which is why the column above adds up."
        />
        <div className="card-body p-0">
          <div className="table-responsive">
            <table className="table table-nowrap table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>#</th>
                  <th className="text-end">Gross</th>
                  <th className="text-end">SSS EE</th>
                  <th className="text-end">PhilHealth EE</th>
                  <th className="text-end">Pag-IBIG EE</th>
                  <th className="text-end">Tax</th>
                  <th className="text-end">Net</th>
                  <th className="text-end">Treasury draw</th>
                </tr>
              </thead>
              <tbody>
                {periods.map((period) => (
                  <tr key={period.periodOfMonth}>
                    <td className="font-monospace">{period.periodOfMonth}</td>
                    <td className="text-end font-monospace">{formatPeso(period.gross)}</td>
                    <td className="text-end font-monospace">{formatPeso(period.sssEE)}</td>
                    <td className="text-end font-monospace">{formatPeso(period.phicEE)}</td>
                    <td className="text-end font-monospace">{formatPeso(period.hdmfEE)}</td>
                    <td className="text-end font-monospace">{formatPeso(period.tax)}</td>
                    <td className="text-end font-monospace fw-medium">{formatPeso(period.net)}</td>
                    <td className="text-end font-monospace">{formatPeso(period.totalDrawn)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="table-light">
                <tr>
                  <th>Σ</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.gross))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.sssEE))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.phicEE))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.hdmfEE))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.tax))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.net))}</th>
                  <th className="text-end font-monospace">{formatPeso(total((p) => p.totalDrawn))}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </Card>
    </div>
  )
}
