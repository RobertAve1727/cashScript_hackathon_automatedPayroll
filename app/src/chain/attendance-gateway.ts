import { useEffect, useState } from 'react'
import { encodePunch, workedBasisPoints, type Punch, type TimeRecord } from '@domain/attendance/time-record'
import { bytesToHex } from '../lib/format'
import { hasSupabase, supabase } from '../data/supabase'
import { clear, load, save, STORAGE_KEYS } from './persistence'

/**
 * Attendance punches, stored in Postgres when a backend is configured and in
 * the browser when one is not.
 *
 * ══ WHY THIS READS PUNCHES AND NOT DAYS ═════════════════════════════════
 *
 * The chain has no concept of a day. It has punches: one OP_RETURN per tap,
 * each a claim about a moment that has already passed. A day — arrival,
 * departure, hours worked — is a fold over punches, not a thing anyone writes.
 *
 * The database is shaped the same way on purpose. `attendance_punches` is
 * append-only; `attendance_records` is a projection a trigger maintains, and
 * its client write policies were dropped in migration 0004 so that no client
 * can assert a day its own punches contradict.
 *
 * This module reads the punches and folds them here, rather than reading the
 * projection, because the fold is what the screens actually need: the proof
 * view lists the individual anchors behind a row, and a day row alone cannot
 * produce them. The projection exists for SQL consumers — the daemon, reports
 * — that want one row per day without a group-by.
 *
 * ══ WHY EVERY READ IS ASYNC NOW ═════════════════════════════════════════
 *
 * It used to be synchronous, because it was a Map in memory. A network round
 * trip cannot be, and pretending otherwise by resolving from a stale cache
 * would mean a screen showing "no attendance recorded" — which reads as a
 * factual claim about an employee — while the request is still in flight.
 * `useAttendance` therefore reports `loading` separately from an empty list,
 * and the screens distinguish the two.
 *
 * ══ THE WORKING DAY IS A PHILIPPINE DAY ═════════════════════════════════
 *
 * `workDateOf` resolves in Asia/Manila rather than in the browser's timezone.
 * This is payroll under the Philippine Labor Code: the day an employee worked
 * is a Philippine calendar day whether the laptop rendering it is in Manila or
 * not. It also has to match, because the database trigger checks that a
 * punch's timestamp falls on the `work_date` it claims — a browser in another
 * timezone filing near midnight would otherwise have the insert refused.
 */

export interface AnchoredPunch extends Punch {
  /** The 13-byte OP_RETURN payload, as it would appear after the `6a` opcode. */
  readonly payloadHex: string
  /** Null until the anchor transaction is broadcast; synthesised offline. */
  readonly txid: string
  readonly workDate: string
}

export interface AttendanceDay extends TimeRecord {
  readonly punches: readonly AnchoredPunch[]
}

export interface AttendanceGateway {
  punch(employeeNo: number, kind: Punch['kind']): Promise<AnchoredPunch>
  daysFor(employeeNo: number): Promise<readonly AttendanceDay[]>
  allDays(): Promise<readonly AttendanceDay[]>
  subscribe(listener: () => void): () => void
}

/**
 * The Philippine calendar day of a unix timestamp, as `YYYY-MM-DD`.
 *
 * `en-CA` because it formats as ISO; there is no locale-independent way to ask
 * Intl for a date in a given zone, and hand-rolling a UTC+8 offset would be
 * wrong the moment the Philippines observes anything else.
 */
export function workDateOf(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(unixSeconds * 1000))
}

/** Fold punches into days, the same rules the database projection applies. */
function foldDays(punches: readonly AnchoredPunch[]): readonly AttendanceDay[] {
  const days = new Map<string, AttendanceDay>()

  for (const punch of [...punches].sort((a, b) => a.at - b.at)) {
    const key = `${punch.employeeNo}:${punch.workDate}`
    const existing = days.get(key)

    if (!existing) {
      // A day that starts with an 'out' punch should be impossible — both the
      // database trigger and the local gateway refuse it — but a fold must not
      // crash on data it did not write.
      days.set(key, {
        employeeNo: punch.employeeNo,
        workDate: punch.workDate,
        timeIn: punch.at,
        // Spread rather than `timeOut: undefined`: an absent departure and one
        // explicitly set to undefined are different types under
        // exactOptionalPropertyTypes, and `openDay` distinguishes them.
        ...(punch.kind === 'out' ? { timeOut: punch.at } : {}),
        punches: [punch],
      })
      continue
    }

    // Earliest arrival wins: tapping in twice must never move the clock
    // forward. Latest departure wins: a second tap out extends the day rather
    // than truncating it.
    const timeOut =
      punch.kind === 'out' ? Math.max(existing.timeOut ?? punch.at, punch.at) : existing.timeOut

    days.set(key, {
      ...existing,
      timeIn: punch.kind === 'in' ? Math.min(existing.timeIn, punch.at) : existing.timeIn,
      ...(timeOut === undefined ? {} : { timeOut }),
      punches: [...existing.punches, punch],
    })
  }

  return [...days.values()].sort((a, b) => b.timeIn - a.timeIn)
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * A txid-shaped identifier for punches with no anchor transaction yet.
 *
 * Deterministic in the punch rather than random, so the same punch always
 * displays the same id. Offline this stands in for the broadcast txid; against
 * Supabase it fills the gap between recording a punch and anchoring it, which
 * is a real gap — the row exists the moment the tap happens, the anchor
 * arrives when someone with a key broadcasts it.
 */
function syntheticTxid(employeeNo: number, at: number, kind: Punch['kind']): string {
  // Seeded by the punch itself, never by its position in a result set. Salting
  // with an ordinal made the write path and the read path mint different ids
  // for the same punch, so a placeholder anchor changed the moment the page
  // reloaded — which reads as the record having changed.
  const seed = `${employeeNo}${at}${kind}`
  let hex = ''
  let carry = 0x9e_37_79_b9

  for (let index = 0; index < 32; index += 1) {
    carry = (carry * 33 + seed.charCodeAt(index % seed.length) + index) >>> 0
    hex += (carry & 0xff).toString(16).padStart(2, '0')
  }

  return hex
}

function anchorOf(punch: Punch, workDate: string): AnchoredPunch {
  return {
    ...punch,
    workDate,
    payloadHex: bytesToHex(encodePunch(punch)),
    txid: syntheticTxid(punch.employeeNo, punch.at, punch.kind),
  }
}

// ── Local ────────────────────────────────────────────────────────────────

/**
 * The offline path, unchanged in behaviour from before Supabase existed: a
 * fresh clone with no backend still runs, and a demo does not fail because a
 * network is unreachable.
 */
class LocalAttendanceGateway implements AttendanceGateway {
  private punches: AnchoredPunch[] = []

  constructor() {
    this.punches = load<AnchoredPunch[]>(STORAGE_KEYS.attendance) ?? []
    // The pre-fold shape lived under a different key and is not readable as
    // punches. Drop it rather than leave it accumulating in storage.
    clear([STORAGE_KEYS.attendanceLegacy])
  }

  punch(employeeNo: number, kind: Punch['kind']): Promise<AnchoredPunch> {
    const at = Math.floor(Date.now() / 1000)
    const workDate = workDateOf(at)

    if (kind === 'out' && !this.punches.some((p) => p.employeeNo === employeeNo && p.workDate === workDate && p.kind === 'in')) {
      return Promise.reject(
        new Error(`Cannot clock out on ${workDate}: employee #${employeeNo} never clocked in`),
      )
    }

    const anchored = anchorOf({ employeeNo, kind, at }, workDate)
    this.punches = [...this.punches, anchored]

    save(STORAGE_KEYS.attendance, this.punches)
    emit()

    return Promise.resolve(anchored)
  }

  daysFor(employeeNo: number): Promise<readonly AttendanceDay[]> {
    return Promise.resolve(foldDays(this.punches.filter((p) => p.employeeNo === employeeNo)))
  }

  allDays(): Promise<readonly AttendanceDay[]> {
    return Promise.resolve(foldDays(this.punches))
  }

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

// ── Supabase ─────────────────────────────────────────────────────────────

interface PunchRow {
  work_date: string
  kind: 'in' | 'out'
  punched_at: string
  payload_hex: string
  anchor_tx_id: string | null
  employees: { employee_no: string } | null
}

class SupabaseAttendanceGateway implements AttendanceGateway {
  async punch(employeeNo: number, kind: Punch['kind']): Promise<AnchoredPunch> {
    const client = supabase()
    if (!client) throw new Error('No backend configured.')

    const { data: auth } = await client.auth.getUser()
    if (!auth.user) throw new Error('Sign in again — this session has expired.')

    const { data: profile } = await client
      .from('profiles')
      .select('employee_id')
      .eq('id', auth.user.id)
      .maybeSingle<{ employee_id: string | null }>()

    if (!profile?.employee_id) {
      throw new Error('This account is not linked to an employment record, so it cannot clock in.')
    }

    const at = Math.floor(Date.now() / 1000)
    const workDate = workDateOf(at)
    const anchored = anchorOf({ employeeNo, kind, at }, workDate)

    const { error } = await client.from('attendance_punches').insert({
      employee_id: profile.employee_id,
      work_date: workDate,
      kind,
      punched_at: new Date(at * 1000).toISOString(),
      payload_hex: anchored.payloadHex,
    })

    if (error) throw new Error(friendly(error.message))

    emit()
    return anchored
  }

  daysFor(employeeNo: number): Promise<readonly AttendanceDay[]> {
    // No employee filter: row-level security already narrows this to the
    // caller's own punches for an employee and to everything for HR, so
    // filtering here could only make it narrower, never safer.
    return this.read()
  }

  allDays(): Promise<readonly AttendanceDay[]> {
    return this.read()
  }

  private async read(): Promise<readonly AttendanceDay[]> {
    const client = supabase()
    if (!client) return []

    const { data, error } = await client
      .from('attendance_punches')
      .select('work_date, kind, punched_at, payload_hex, anchor_tx_id, employees(employee_no)')
      .order('punched_at', { ascending: true })

    // Throw rather than return []. This module's own doc says an empty list is
    // a factual claim about whether someone came to work, and a failed query is
    // not that claim — `useAttendance` surfaces the error and the screens show
    // it instead of a clean, wrong "nothing recorded yet".
    if (error) throw new Error(friendly(error.message))
    if (!data) return []

    return foldDays(
      (data as unknown as PunchRow[]).map((row) => {
        const at = Math.floor(new Date(row.punched_at).getTime() / 1000)
        const employeeNo = Number(row.employees?.employee_no ?? 0)

        return {
          employeeNo,
          kind: row.kind,
          at,
          workDate: row.work_date,
          payloadHex: row.payload_hex,
          txid: row.anchor_tx_id ?? syntheticTxid(employeeNo, at, row.kind),
        }
      }),
    )
  }

  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }
}

/** Turn the database's own refusals into something a person can act on. */
function friendly(message: string): string {
  if (/there is no clock-in/i.test(message)) return 'You have not clocked in today.'
  if (/cannot be edited|cannot be deleted/i.test(message)) return 'A punch cannot be changed once recorded.'
  if (/payload_hex/i.test(message)) return 'That punch did not encode to 13 bytes — refusing to record it.'
  if (/not on work_date/i.test(message)) return 'That punch timestamp does not fall on the day it claims.'
  if (/row-level security|permission denied/i.test(message)) return 'Your role cannot record that punch.'
  return message
}

export const attendanceGateway: AttendanceGateway = hasSupabase()
  ? new SupabaseAttendanceGateway()
  : new LocalAttendanceGateway()

/** Whether attendance is durable beyond this browser. Screens say which. */
export function attendanceBackend(): 'supabase' | 'local' {
  return hasSupabase() ? 'supabase' : 'local'
}

/**
 * Subscribe a screen to attendance.
 *
 * `loading` is reported separately from an empty list because the two mean
 * very different things on a screen about whether someone turned up for work.
 */
export function useAttendance(employeeNo?: number): {
  days: readonly AttendanceDay[]
  loading: boolean
  error: string | null
  reload: () => void
} {
  const [days, setDays] = useState<readonly AttendanceDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)

    const read =
      employeeNo === undefined
        ? attendanceGateway.allDays()
        : attendanceGateway.daysFor(employeeNo)

    void read
      .then((rows) => {
        if (!alive) return
        setDays(rows)
        setError(null)
      })
      .catch((thrown: unknown) => {
        if (!alive) return
        setError(thrown instanceof Error ? thrown.message : String(thrown))
      })
      .finally(() => {
        if (alive) setLoading(false)
      })

    const listener = (): void => setTick((n) => n + 1)
    listeners.add(listener)

    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [employeeNo, tick])

  return { days, loading, error, reload: () => setTick((n) => n + 1) }
}

/** The day currently open for an employee, if they are clocked in. */
export function openDay(days: readonly AttendanceDay[]): AttendanceDay | undefined {
  return days.find((day) => day.timeOut === undefined)
}

/** Basis points of a workday, summed — what the payroll engine consumes. */
export function periodBasisPoints(days: readonly AttendanceDay[]): number {
  return days.reduce((total, day) => total + workedBasisPoints(day), 0)
}
