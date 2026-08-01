import { useEffect, useState } from 'react'
import { hasSupabase, supabase, type OvertimeRow } from './supabase'

/**
 * Overtime requests, from Supabase when configured and from memory when not.
 *
 * The rule is enforced in three places on purpose, and that is not
 * duplication for its own sake:
 *
 *   1. `src/domain/attendance/overtime.ts` — `approvedOvertimeMinutes` filters
 *      on `status === 'approved'`, so payroll cannot be handed unapproved
 *      hours because it never sees them.
 *   2. The database — a CHECK constraint refuses a decision with no approver,
 *      and a trigger refuses to reverse one. A client that forgets the rule
 *      cannot write past it.
 *   3. Row-level security — only HR can UPDATE the table at all, so an
 *      employee cannot approve their own request even with a crafted request.
 *
 * The first is correctness, the second is durability, the third is authority.
 * Removing any one of them leaves a way for unapproved hours to become money.
 */

export interface OvertimeRequestView {
  id: string
  employeeId: string
  employeeNo?: number
  workDate: string
  minutes: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  filedAt: string
  decidedAt?: string | null
}

const listeners = new Set<() => void>()
let memory: OvertimeRequestView[] = []

function emit(): void {
  for (const listener of listeners) listener()
}

function fromRow(row: OvertimeRow): OvertimeRequestView {
  return {
    id: row.id,
    employeeId: row.employee_id,
    workDate: row.work_date,
    minutes: row.minutes,
    reason: row.reason,
    status: row.status,
    filedAt: row.filed_at,
    decidedAt: row.decided_at,
  }
}

/**
 * The signed-in user's `employees.id`, which every request is keyed to.
 *
 * Read from `profiles`, not from anything the client holds: RLS decides what
 * the row means, and a client-supplied employee id would be a claim rather
 * than a fact.
 */
async function currentEmployeeId(): Promise<string | null> {
  const client = supabase()
  if (!client) return null

  const { data: auth } = await client.auth.getUser()
  if (!auth.user) return null

  const { data } = await client
    .from('profiles')
    .select('employee_id')
    .eq('id', auth.user.id)
    .maybeSingle<{ employee_id: string | null }>()

  return data?.employee_id ?? null
}

export async function listOvertime(): Promise<readonly OvertimeRequestView[]> {
  const client = supabase()
  if (!client) return memory

  // No employee filter: row-level security already narrows this to the
  // caller's own rows for an employee, and to everything for HR. Filtering
  // again here would only be able to make it narrower, never safer.
  const { data, error } = await client
    .from('overtime_requests')
    .select('*')
    .order('work_date', { ascending: false })

  if (error || !data) return []
  return (data as OvertimeRow[]).map(fromRow)
}

export async function fileOvertime(input: {
  workDate: string
  minutes: number
  reason: string
}): Promise<{ ok: boolean; error?: string }> {
  const client = supabase()

  if (!client) {
    memory = [
      {
        id: `local-${memory.length + 1}`,
        employeeId: 'local',
        workDate: input.workDate,
        minutes: input.minutes,
        reason: input.reason,
        status: 'pending',
        filedAt: new Date().toISOString(),
      },
      ...memory,
    ]
    emit()
    return { ok: true }
  }

  const employeeId = await currentEmployeeId()
  if (!employeeId) return { ok: false, error: 'This account is not linked to an employment record.' }

  const { error } = await client.from('overtime_requests').insert({
    employee_id: employeeId,
    work_date: input.workDate,
    minutes: input.minutes,
    reason: input.reason,
    // Filing always starts pending. The insert policy requires it, so a
    // client that tried to self-approve would be rejected by the database.
    status: 'pending',
  })

  emit()
  return error ? { ok: false, error: friendly(error.message) } : { ok: true }
}

export async function decideOvertime(
  id: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  const client = supabase()

  if (!client) {
    memory = memory.map((r) =>
      r.id === id && r.status === 'pending'
        ? { ...r, status, decidedAt: new Date().toISOString() }
        : r,
    )
    emit()
    return { ok: true }
  }

  const { data: auth } = await client.auth.getUser()

  const { error } = await client
    .from('overtime_requests')
    .update({
      status,
      decided_by: auth.user?.id ?? null,
      decided_at: new Date().toISOString(),
      ...(note === undefined ? {} : { decision_note: note }),
    })
    .eq('id', id)

  emit()
  return error ? { ok: false, error: friendly(error.message) } : { ok: true }
}

/** Turn the database's own refusals into something an operator can act on. */
function friendly(message: string): string {
  if (/decision is final/i.test(message)) return 'That request was already decided — a decision is final.'
  if (/overtime_decision_is_complete/i.test(message)) return 'A decision must record who made it and when.'
  if (/overtime_requests_minutes_check|minutes/i.test(message)) return 'Overtime must be between 1 minute and 8 hours.'
  if (/duplicate key|unique/i.test(message)) return 'There is already a request for that date.'
  if (/row-level security|permission denied/i.test(message)) return 'Your role cannot do that.'
  return message
}

/** Subscribe a screen to the overtime list. */
export function useOvertime(): {
  requests: readonly OvertimeRequestView[]
  loading: boolean
  reload: () => void
} {
  const [requests, setRequests] = useState<readonly OvertimeRequestView[]>([])
  const [loading, setLoading] = useState(hasSupabase())
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void listOvertime().then((rows) => {
      if (!alive) return
      setRequests(rows)
      setLoading(false)
    })

    const listener = (): void => setTick((n) => n + 1)
    listeners.add(listener)

    return () => {
      alive = false
      listeners.delete(listener)
    }
  }, [tick])

  return { requests, loading, reload: () => setTick((n) => n + 1) }
}
