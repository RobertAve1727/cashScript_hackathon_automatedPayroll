import { workedBasisPoints, workedSeconds } from '@domain/attendance/time-record'
import { useAttendance } from '../chain/attendance-gateway'
import { useChainState } from '../chain/use-chain'
import { Card, CardHeader, Loading, PageHeader, StatTile } from '../components/ui'
import { truncateHex } from '../lib/format'
import { useProofView } from '../view/proof-view'

/**
 * /hr/attendance — every employee's daily time record, and where each one came
 * from.
 *
 * The column that matters is the last one. In an ordinary HRIS, attendance is a
 * row someone with the admin password can edit, and a disputed day comes down
 * to whose word it is. Here each row cites the punches that produced it, so HR
 * reviews attendance without being able to quietly rewrite it.
 */
export default function AttendancePage() {
  const state = useChainState()
  const days = useAttendance()
  const proofView = useProofView()

  if (!state) return <Loading />

  const nameOf = (employeeNo: number): string =>
    state.employees.find((employee) => employee.employeeNo === employeeNo)?.name ?? `#${employeeNo}`

  const settled = days.filter((day) => day.timeOut !== undefined)
  const open = days.length - settled.length
  const fullDays = settled.filter((day) => workedBasisPoints(day) === 10_000).length
  const anchors = days.reduce((total, day) => total + day.punches.length, 0)

  return (
    <div className="content">
      <PageHeader title="Attendance" section="Human Resources" />

      <div className="row">
        <div className="col-xl-3 col-md-6">
          <StatTile label="Days recorded" value={days.length} icon="ti ti-calendar-time" tone="primary" />
        </div>
        <div className="col-xl-3 col-md-6">
          <StatTile label="Full days" value={fullDays} icon="ti ti-checkbox" tone="success" />
        </div>
        <div className="col-xl-3 col-md-6">
          <StatTile
            label="Still clocked in"
            value={open}
            sub="Not yet payable"
            icon="ti ti-hourglass"
            tone="warning"
          />
        </div>
        <div className="col-xl-3 col-md-6">
          <StatTile
            label="On-chain records"
            value={anchors}
            sub={proofView ? 'OP_RETURN punches' : 'Clock-ins and clock-outs'}
            icon="ti ti-link"
            tone="info"
          />
        </div>
      </div>

      <Card>
        <CardHeader
          title="Daily time records"
          hint={
            proofView
              ? 'Every row cites the anchor transactions that produced it. HR reviews attendance here; nobody edits it.'
              : 'HR reviews attendance here. Nobody edits it — every row came from a clock-in the employee made.'
          }
        />
        <div className="card-body p-0">
          {days.length === 0 ? (
            <p className="text-muted p-3 mb-0">
              No attendance yet — sign in as an employee and use the Time Clock.
            </p>
          ) : (
            <div className="table-responsive">
              <table className="table table-nowrap mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Employee</th>
                    <th>Date</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Hours</th>
                    <th>Day worked</th>
                    {proofView ? <th>Anchored punches</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {days.map((day) => (
                    <tr key={`${day.employeeNo}:${day.workDate}`}>
                      <td>
                        <h6 className="fw-medium mb-0">{nameOf(day.employeeNo)}</h6>
                        <span className="fs-12 text-muted">#{day.employeeNo}</span>
                      </td>
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
                        <td className="fs-12">
                          {day.punches.map((punch) => (
                            <span key={punch.txid} className="d-block font-monospace text-muted">
                              <span className={punch.kind === 'in' ? 'text-success' : 'text-danger'}>
                                {punch.kind === 'in' ? 'in ' : 'out'}
                              </span>{' '}
                              {truncateHex(punch.txid, 10, 6)}
                            </span>
                          ))}
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
