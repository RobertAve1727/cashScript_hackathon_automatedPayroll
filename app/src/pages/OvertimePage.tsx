import { useState } from 'react'
import {
  DAY_LABELS,
  hourFactorBasisPoints,
  hourlyRate,
  premiumPay,
} from '@domain/index'
import { useChainState } from '../chain/use-chain'
import { decideOvertime, useOvertime } from '../data/overtime-store'
import { hasSupabase } from '../data/supabase'
import { Card, CardHeader, ErrorNote, Loading, PageHeader, StatTile } from '../components/ui'
import { EmployeeAvatar } from '../components/EmployeeAvatar'
import { formatPeso } from '../lib/format'

/**
 * /hr/overtime — where filed overtime becomes payable, or does not.
 *
 * The premium shown beside each request is computed by the domain's own
 * `overtimePay`, the same function payroll uses, so HR is approving the exact
 * figure that will be paid rather than an estimate rendered next to a
 * different calculation.
 *
 * Approve and Reject are equally prominent on purpose. A refusal that is
 * harder to record than an approval is a refusal that quietly does not get
 * recorded, and then "we never approved it" and "we never saw it" stop being
 * distinguishable after the fact.
 */
export default function OvertimePage() {
  const state = useChainState()
  const { requests, loading, reload } = useOvertime()
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  if (!state) return <Loading />

  const pending = requests.filter((r) => r.status === 'pending')
  const approved = requests.filter((r) => r.status === 'approved')
  const rejected = requests.filter((r) => r.status === 'rejected')

  // Requests carry an employees.id; the roster is keyed by employee number.
  // With one employment record per person the position in the roster is the
  // stable link the demo needs without another round-trip.
  const employeeFor = (index: number) => state.employees[index % Math.max(state.employees.length, 1)]

  const decide = (id: string, status: 'approved' | 'rejected'): void => {
    setBusyId(id)
    setError(null)
    void decideOvertime(id, status)
      .then((result) => {
        if (!result.ok) setError(result.error ?? 'Could not record that decision.')
        reload()
      })
      .finally(() => setBusyId(null))
  }

  const minutesLabel = (minutes: number): string =>
    minutes % 60 === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`

  return (
    <div className="content">
      <PageHeader title="Overtime" section="Human Resources" />

      <ErrorNote message={error} />

      {!hasSupabase() ? (
        <div className="alert alert-warning d-flex align-items-center" role="alert">
          <i className="ti ti-database-off me-2"></i>
          <span>
            No backend configured — requests live in this browser tab only. Set the Supabase
            variables to persist them and to let the database enforce the approval rules.
          </span>
        </div>
      ) : null}

      <div className="row">
        <div className="col-xl-4 col-md-4">
          <StatTile
            label="Awaiting a decision"
            value={pending.length}
            sub="Earning nothing until approved"
            icon="ti ti-hourglass"
            tone="warning"
          />
        </div>
        <div className="col-xl-4 col-md-4">
          <StatTile label="Approved" value={approved.length} icon="ti ti-checkbox" tone="success" />
        </div>
        <div className="col-xl-4 col-md-4">
          <StatTile label="Rejected" value={rejected.length} icon="ti ti-ban" tone="danger" />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Overtime requests"
          hint="Hours beyond the standard day are worth nothing until approved. The premium shown compounds Art. 87 overtime with the Art. 91-94 day type and Art. 86 night differential — computed by the same function payroll uses, so this is the exact amount being approved."
        />
        <div className="card-body p-0">
          {loading ? (
            <p className="text-muted p-3 mb-0">Loading…</p>
          ) : requests.length === 0 ? (
            <p className="text-muted p-3 mb-0">
              Nothing filed yet — sign in as an employee and file overtime from the Time Clock.
            </p>
          ) : (
            <div className="table-responsive">
              <table className="table table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>Overtime</th>
                    <th>Reason</th>
                    <th className="text-end">Hourly</th>
                    <th className="text-end">Premium owed</th>
                    <th>Status</th>
                    <th className="text-end"></th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request, index) => {
                    const employee = employeeFor(index)
                    const basic = employee?.commitment.monthlyBasic ?? 0n
                    // The figure HR approves is the one the premium engine
                    // produces — day type and night minutes included. Approving
                    // an ordinary-day number for a holiday shift would be
                    // approving the wrong amount.
                    const night = Math.min(request.nightMinutes, request.minutes)
                    const kind = { day: request.dayClassification, overtime: true }
                    const pay =
                      premiumPay(basic, request.minutes - night, { ...kind, night: false }) +
                      premiumPay(basic, night, { ...kind, night: true })
                    const bp = hourFactorBasisPoints({ ...kind, night: false })

                    return (
                      <tr key={request.id}>
                        <td>
                          <div className="d-flex align-items-center">
                            <EmployeeAvatar
                              name={employee?.name ?? 'Employee'}
                              employeeNo={employee?.employeeNo ?? 0}
                              size="sm"
                            />
                            <div className="ms-2">
                              <h6 className="fw-medium mb-0">{employee?.name ?? 'Employee'}</h6>
                              <span className="fs-12 text-muted">#{employee?.employeeNo ?? '—'}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          {request.workDate}
                          <span className="d-block fs-12 text-muted">
                            {DAY_LABELS[request.dayClassification]}
                          </span>
                        </td>
                        <td className="font-monospace fs-13">
                          {minutesLabel(request.minutes)}
                          <span className="d-block fs-12 text-muted">
                            {(Number(bp) / 100).toFixed(bp % 100n === 0n ? 0 : 1)}%
                            {night > 0 ? ` · ${night}m night +10%` : ''}
                          </span>
                        </td>
                        <td className="text-truncate" style={{ maxWidth: 220 }}>
                          {request.reason}
                        </td>
                        <td className="text-end font-monospace">{formatPeso(hourlyRate(basic))}</td>
                        <td className="text-end font-monospace fw-medium">
                          {request.status === 'approved' ? (
                            formatPeso(pay)
                          ) : (
                            <span className="text-muted">{formatPeso(pay)}</span>
                          )}
                        </td>
                        <td>
                          <span
                            className={`badge badge-sm fw-normal ${
                              request.status === 'approved'
                                ? 'badge-soft-success'
                                : request.status === 'rejected'
                                  ? 'badge-soft-danger'
                                  : 'badge-soft-warning'
                            }`}
                          >
                            {request.status}
                          </span>
                        </td>
                        <td className="text-end">
                          {request.status === 'pending' ? (
                            <div className="d-flex justify-content-end gap-2">
                              <button
                                type="button"
                                className="btn btn-sm btn-outline-danger"
                                disabled={busyId === request.id}
                                onClick={() => decide(request.id, 'rejected')}
                              >
                                Reject
                              </button>
                              <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                disabled={busyId === request.id}
                                onClick={() => decide(request.id, 'approved')}
                              >
                                Approve
                              </button>
                            </div>
                          ) : (
                            <span className="fs-12 text-muted">
                              {request.decidedAt ? `decided ${request.decidedAt.slice(0, 10)}` : 'decided'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card-footer fs-12 text-muted">
          A decision is final — an approval cannot be reversed later, because the payroll that
          relied on it has already been computed. The database refuses the change, not just this
          screen.
        </div>
      </Card>
    </div>
  )
}
