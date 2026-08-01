import { useEffect, useState } from 'react'
import { encodePunch, workedBasisPoints, type Punch, type TimeRecord } from '@domain/attendance/time-record'
import { bytesToHex } from '../lib/format'

/**
 * Attendance, in memory, with each punch carrying the exact bytes it would be
 * anchored with on chain.
 *
 * The payload is built by the domain's own `encodePunch`, not re-implemented
 * here, so what the screen displays as the OP_RETURN is byte-for-byte what
 * `buildAttendanceAnchorTransaction` would broadcast. Only the broadcast is
 * mocked: the txid is synthesised, the 13 bytes are real.
 *
 * The seam mirrors `ChainGateway` — a chipnet adapter would implement the same
 * three methods over ElectrumNetworkProvider and no screen would change.
 */

export interface AnchoredPunch extends Punch {
  /** The 13-byte OP_RETURN payload, as it would appear after the `6a` opcode. */
  readonly payloadHex: string
  /** Synthesised here; a real adapter returns the broadcast txid. */
  readonly txid: string
  readonly workDate: string
}

export interface AttendanceDay extends TimeRecord {
  readonly punches: readonly AnchoredPunch[]
}

export interface AttendanceGateway {
  punch(employeeNo: number, kind: Punch['kind']): AnchoredPunch
  daysFor(employeeNo: number): readonly AttendanceDay[]
  allDays(): readonly AttendanceDay[]
  subscribe(listener: () => void): () => void
}

/** Local calendar day as `YYYY-MM-DD` — the key a daily payroll runs on. */
export function workDateOf(unixSeconds: number): string {
  const date = new Date(unixSeconds * 1000)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

class InMemoryAttendanceGateway implements AttendanceGateway {
  private readonly days = new Map<string, AttendanceDay>()
  private readonly listeners = new Set<() => void>()
  private nonce = 0

  punch(employeeNo: number, kind: Punch['kind']): AnchoredPunch {
    const at = Math.floor(Date.now() / 1000)
    const workDate = workDateOf(at)
    const punch: Punch = { employeeNo, kind, at }

    const anchored: AnchoredPunch = {
      ...punch,
      workDate,
      payloadHex: bytesToHex(encodePunch(punch)),
      txid: this.syntheticTxid(employeeNo, at),
    }

    const key = `${employeeNo}:${workDate}`
    const existing = this.days.get(key)

    if (kind === 'in') {
      // Clocking in again on a day already open keeps the original arrival —
      // an accidental second tap must never quietly reset the clock.
      this.days.set(
        key,
        existing ?? { employeeNo, workDate, timeIn: at, punches: [anchored] },
      )
      if (existing) {
        this.days.set(key, { ...existing, punches: [...existing.punches, anchored] })
      }
    } else {
      if (!existing) {
        throw new Error(`Cannot clock out on ${workDate}: employee #${employeeNo} never clocked in`)
      }
      this.days.set(key, { ...existing, timeOut: at, punches: [...existing.punches, anchored] })
    }

    this.emit()
    return anchored
  }

  daysFor(employeeNo: number): readonly AttendanceDay[] {
    return this.allDays().filter((day) => day.employeeNo === employeeNo)
  }

  allDays(): readonly AttendanceDay[] {
    return [...this.days.values()].sort((a, b) => b.timeIn - a.timeIn)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * A txid-shaped identifier so the UI can show what an explorer would show.
   * Deterministic in the punch rather than random, so the same punch always
   * displays the same id within a session.
   */
  private syntheticTxid(employeeNo: number, at: number): string {
    this.nonce += 1
    const seed = `${employeeNo}${at}${this.nonce}`
    let hex = ''
    let carry = 0x9e_37_79_b9
    for (let index = 0; index < 32; index += 1) {
      carry = (carry * 33 + seed.charCodeAt(index % seed.length) + index) >>> 0
      hex += (carry & 0xff).toString(16).padStart(2, '0')
    }
    return hex
  }
}

export const attendanceGateway: AttendanceGateway = new InMemoryAttendanceGateway()

/** Subscribe a screen to attendance. */
export function useAttendance(employeeNo?: number): readonly AttendanceDay[] {
  const [days, setDays] = useState<readonly AttendanceDay[]>(() =>
    employeeNo === undefined ? attendanceGateway.allDays() : attendanceGateway.daysFor(employeeNo),
  )

  useEffect(() => {
    const refresh = (): void =>
      setDays(
        employeeNo === undefined ? attendanceGateway.allDays() : attendanceGateway.daysFor(employeeNo),
      )
    refresh()

    return attendanceGateway.subscribe(refresh)
  }, [employeeNo])

  return days
}

/** The day currently open for an employee, if they are clocked in. */
export function openDay(days: readonly AttendanceDay[]): AttendanceDay | undefined {
  return days.find((day) => day.timeOut === undefined)
}

/** Basis points of a workday, summed — what the payroll engine consumes. */
export function periodBasisPoints(days: readonly AttendanceDay[]): number {
  return days.reduce((total, day) => total + workedBasisPoints(day), 0)
}
