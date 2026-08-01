import { Fragment, useState } from 'react'
import {
  STANDARD_WORKDAY_SECONDS,
  workedBasisPoints,
  workedSeconds,
} from '@domain/attendance/time-record'
import { computeScheduledDeductions, DAILY } from '@domain/index'
import { useChainState } from '../chain/use-chain'
import { attendanceGateway, openDay, useAttendance, type AnchoredPunch } from '../chain/attendance-gateway'
import { Card, CardHeader, ErrorNote, Loading, PageHeader } from '../components/ui'
import { formatPeso, formatWhen, truncateHex } from '../lib/format'
import { useSession } from '../auth/session'
import { useProofView } from '../view/proof-view'
import { fileOvertime, useOvertime } from '../data/overtime-store'
import { MAX_OVERTIME_MINUTES_PER_DAY, overtimePay } from '@domain/index'

/**
 * /my/time — the employee's clock, and the moment attendance becomes a fact.
 *
 * Every tap writes a 13-byte OP_RETURN. The bytes shown on this page are built
 * by the domain's own `encodePunch`, so what the employee reads here is
 * byte-for-byte what a block explorer would show. That is the whole point of
 * anchoring: the employer keeps the HRIS, but no longer holds the only copy of
 * when someone arrived.
 *
 * The earnings panel below is the answer to "am I being paid for this day" —
 * computed live from the same engine that would settle it, so the employee can
 * see the day's pay accrue rather than discover it on a payslip two weeks on.
 */
export default function TimeClockPage() {
  const user = useSession()
  const employeeNo = user?.employeeNo ?? 0
  const state = useChainState()
  const days = useAttendance(employeeNo)
  const [error, setError] = useState<string | null>(null)
  const [lastPunch, setLastPunch] = useState<AnchoredPunch | null>(null)
  const proofView = useProofView()
  const { requests: overtime, reload: reloadOvertime } = useOvertime()
  const [otMinutes, setOtMinutes] = useState('120')
  const [otReason, setOtReason] = useState('')
  const [otNote, setOtNote] = useState<string | null>(null)

  if (!state) return <Loading />

  const today = openDay(days)
  const clockedIn = today !== undefined
  const record = state.employees.find((employee) => employee.employeeNo === employeeNo)

  const punch = (kind: 'in' | 'out'): void => {
    setError(null)
    try {
      setLastPunch(attendanceGateway.punch(employeeNo, kind))
    } catch (thrown) {
      setError(thrown instanceof Error ? thrown.message : String(thrown))
    }
  }

  // Today's accrual, from the same engine that settles it. Absent a clock-out
  // the day is still open, so it shows what has been earned so far.
  const settledToday = days.filter((day) => day.timeOut !== undefined && day.workDate === todayKey())
  const workedBp = settledToday.reduce((total, day) => total + workedBasisPoints(day), 0)
  const earnedToday =
    record === undefined
      ? null
      : computeScheduledDeductions({
          monthlyBasic: record.commitment.monthlyBasic,
          monthlyAllowance: record.commitment.monthlyAllowance,
          monthlyTax: record.commitment.taxPerPeriod * 2n,
          schedule: DAILY,
          periodOfMonth: 1,
          periodsWorked: Math.min(workedBp / 10_000, 1),
        })

  return (
    <div className="content">
      <PageHeader title="Time Clock" section="My Work" />

      <ErrorNote message={error} />

      <div className="row">
        <div className="col-xl-5 d-flex">
          <Card className="flex-fill">
            <CardHeader
              title={clockedIn ? 'On the clock' : 'Not clocked in'}
              hint={
                proofView
                  ? 'Each tap is written to the chain as a 13-byte OP_RETURN before it is written anywhere else.'
                  : 'Each tap is recorded on the chain the moment it happens, so it cannot be edited later.'
              }
            />
            <div className="card-body text-center">
              <div
                className={`avatar avatar-xxl rounded-circle mx-auto mb-3 d-flex align-items-center justify-content-center ${
                  clockedIn ? 'bg-success-transparent' : 'bg-light'
                }`}
              >
                <i className={`ti ti-clock-hour-4 fs-32 ${clockedIn ? 'text-success' : 'text-muted'}`}></i>
              </div>

              {today ? (
                <Fragment>
                  <p className="fs-12 mb-1 text-muted">Clocked in at</p>
                  <h4 className="mb-3">{formatWhen(today.timeIn * 1000)}</h4>
                </Fragment>
              ) : (
                <p className="text-muted mb-3">Tap in to start the working day.</p>
              )}

              <div className="d-flex justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={clockedIn}
                  onClick={() => punch('in')}
                >
                  <i className="ti ti-login me-1"></i>Time in
                </button>
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  disabled={!clockedIn}
                  onClick={() => punch('out')}
                >
                  <i className="ti ti-logout me-1"></i>Time out
                </button>
              </div>
            </div>
          </Card>
        </div>

        <div className="col-xl-7 d-flex">
          <Card className="flex-fill">
            <CardHeader
              title="Today’s earnings, as they accrue"
              hint="Computed by the same statutory engine that settles the payment — not an estimate shown next to a different calculation."
            />
            <div className="card-body">
              {earnedToday === null ? (
                <p className="text-muted mb-0">No employment record is linked to this account.</p>
              ) : (
                <div className="row g-3">
                  <div className="col-sm-4">
                    <p className="fs-12 mb-1 text-muted">Day worked</p>
                    <h5 className="mb-0">{(workedBp / 100).toFixed(0)}%</h5>
                    <p className="fs-12 mb-0 text-muted">
                      of an {STANDARD_WORKDAY_SECONDS / 3600}-hour day
                    </p>
                  </div>
                  <div className="col-sm-4">
                    <p className="fs-12 mb-1 text-muted">Gross earned</p>
                    <h5 className="mb-0">{formatPeso(earnedToday.gross)}</h5>
                    <p className="fs-12 mb-0 text-muted">1 of {DAILY.periodsPerMonth} working days</p>
                  </div>
                  <div className="col-sm-4">
                    <p className="fs-12 mb-1 text-muted">Your share, this day</p>
                    <h5 className="mb-0">
                      {formatPeso(
                        earnedToday.sssEE + earnedToday.phicEE + earnedToday.hdmfEE + earnedToday.tax,
                      )}
                    </h5>
                    <p className="fs-12 mb-0 text-muted">SSS, PhilHealth, Pag-IBIG, BIR</p>
                  </div>
                  <div className="col-12">
                    {/*
                      Net is shown only when the day's wage actually covers the
                      day's share. It does not on a day that was not worked, and
                      printing a negative "net pay" there would be a lie about
                      what the employee owes: the contribution is a MONTHLY
                      obligation, so a short day does not create a debt, it
                      shifts the withholding onto the days that are paid.
                    */}
                    {earnedToday.net > 0n ? (
                      <div className="d-flex align-items-center justify-content-between bg-primary-transparent rounded p-3">
                        <span className="fs-13 fw-medium text-uppercase">Net for this day</span>
                        <h4 className="mb-0">{formatPeso(earnedToday.net)}</h4>
                      </div>
                    ) : (
                      <div className="alert alert-light border mb-0 fs-12">
                        No wage earned yet today, so nothing is withheld today either. SSS,
                        PhilHealth and Pag-IBIG are owed on the monthly salary credit for the{' '}
                        <em>month</em>, not per day attended — the contribution does not shrink
                        because a day was missed, and it is withheld from the days that are paid.
                        An employer who remits less because someone took leave is under-remitting.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {proofView && lastPunch ? (
        <Card>
          <CardHeader
            title="The punch that just went on chain"
            hint="13 bytes: magic, version, kind, employee number and an unsigned timestamp — little-endian, the same way the employment commitment is read."
          />
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-4">
                <p className="fs-12 mb-1 text-muted">Anchor transaction</p>
                <p className="mb-0 font-monospace fs-13">{truncateHex(lastPunch.txid, 16, 8)}</p>
              </div>
              <div className="col-md-8">
                <p className="fs-12 mb-1 text-muted">OP_RETURN payload</p>
                <p className="mb-0 font-monospace fs-13 text-break">
                  <span className="text-info">{lastPunch.payloadHex.slice(0, 8)}</span>
                  <span className="text-success">{lastPunch.payloadHex.slice(8, 10)}</span>
                  <span className="text-warning">{lastPunch.payloadHex.slice(10, 12)}</span>
                  <span className="text-purple">{lastPunch.payloadHex.slice(12, 18)}</span>
                  <span className="text-danger">{lastPunch.payloadHex.slice(18)}</span>
                </p>
                <p className="fs-12 mb-0 mt-1 text-muted">
                  <span className="text-info">eSHD</span> ·{' '}
                  <span className="text-success">version</span> ·{' '}
                  <span className="text-warning">{lastPunch.kind === 'in' ? 'in' : 'out'}</span> ·{' '}
                  <span className="text-purple">employee #{lastPunch.employeeNo}</span> ·{' '}
                  <span className="text-danger">{formatWhen(lastPunch.at * 1000)}</span>
                </p>
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {/*
        Filing overtime, not claiming it. The distinction is the point: these
        minutes are worth nothing until HR approves them, so the panel shows
        what they WOULD be worth and says plainly that they are not yet.
      */}
      <Card>
        <CardHeader
          title="Overtime"
          hint="Beyond the standard day. Filing does not earn it — HR has to approve the request first."
        />
        <div className="card-body">
          <div className="row g-3 align-items-end">
            <div className="col-md-3">
              <label className="form-label fs-12 mb-1" htmlFor="ot_minutes">
                Minutes worked beyond the day
              </label>
              <input
                id="ot_minutes"
                className="form-control"
                type="number"
                min={1}
                max={MAX_OVERTIME_MINUTES_PER_DAY}
                value={otMinutes}
                onChange={(e) => setOtMinutes(e.target.value)}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label fs-12 mb-1" htmlFor="ot_reason">
                Reason
              </label>
              <input
                id="ot_reason"
                className="form-control"
                value={otReason}
                onChange={(e) => setOtReason(e.target.value)}
                placeholder="Month-end close"
              />
            </div>
            <div className="col-md-3">
              <button
                type="button"
                className="btn btn-primary w-100"
                disabled={!Number.isInteger(Number(otMinutes)) || Number(otMinutes) <= 0 || otReason.trim() === ''}
                onClick={() => {
                  setOtNote(null)
                  void fileOvertime({
                    workDate: todayKey(),
                    minutes: Number(otMinutes),
                    reason: otReason.trim(),
                  }).then((result) => {
                    setOtNote(result.ok ? 'Filed. It earns nothing until HR approves it.' : (result.error ?? 'Could not file that.'))
                    if (result.ok) setOtReason('')
                    reloadOvertime()
                  })
                }}
              >
                File request
              </button>
            </div>
            {record !== undefined && Number(otMinutes) > 0 ? (
              <div className="col-12">
                <p className="fs-12 mb-0 text-muted">
                  Worth{' '}
                  <span className="fw-medium">
                    {formatPeso(overtimePay(record.commitment.monthlyBasic, Number(otMinutes) || 0))}
                  </span>{' '}
                  at Art. 87 rates (hourly + 25%) — <em>if</em> approved.
                </p>
              </div>
            ) : null}
            {otNote ? (
              <div className="col-12">
                <p className="fs-12 mb-0 text-success">{otNote}</p>
              </div>
            ) : null}
          </div>

          {overtime.length > 0 ? (
            <ul className="list-group list-group-flush mt-3">
              {overtime.slice(0, 5).map((request) => (
                <li
                  key={request.id}
                  className="list-group-item d-flex align-items-center justify-content-between px-0"
                >
                  <span className="fs-13">
                    {request.workDate} · {request.minutes} min · {request.reason}
                  </span>
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
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="My time records"
          hint="Every row is backed by punches already on chain — the employer can dispute a day, but cannot silently rewrite one."
        />
        <div className="card-body p-0">
          {days.length === 0 ? (
            <p className="text-muted p-3 mb-0">Nothing recorded yet.</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Hours</th>
                    <th>Day</th>
                    {proofView ? <th>Anchors</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={`${day.employeeNo}:${day.workDate}`}>
                      <td>{day.workDate}</td>
                      <td className="font-monospace fs-13">{clockTime(day.timeIn)}</td>
                      <td className="font-monospace fs-13">
                        {day.timeOut === undefined ? (
                          <span className="badge badge-soft-warning badge-sm fw-normal">open</span>
                        ) : (
                          clockTime(day.timeOut)
                        )}
                      </td>
                      <td className="font-monospace fs-13">
                        {(workedSeconds(day) / 3600).toFixed(2)}
                      </td>
                      <td>
                        <span
                          className={`badge badge-sm fw-normal ${
                            workedBasisPoints(day) === 10_000
                              ? 'badge-soft-success'
                              : 'badge-soft-secondary'
                          }`}
                        >
                          {(workedBasisPoints(day) / 100).toFixed(0)}%
                        </span>
                      </td>
                      {proofView ? (
                        <td className="font-monospace fs-12 text-muted">
                          {day.punches.map((p) => truncateHex(p.txid, 6, 4)).join(', ')}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

function clockTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString('en-PH', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function todayKey(): string {
  const now = new Date()
  const month = `${now.getMonth() + 1}`.padStart(2, '0')
  const day = `${now.getDate()}`.padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
