import { useEffect, useState } from 'react'
import {
  SEMI_MONTHLY,
  isPayrollCadence,
  scheduleFor,
  type PayrollCadence,
  type PayrollSchedule,
} from '@domain/index'
import { hasSupabase, supabase } from './supabase'
import { load, save } from '../chain/persistence'

/**
 * How often each employee is paid.
 *
 * ══ WHY THIS IS AN HRIS SETTING AND NOT A COMMITMENT FIELD ══════════════
 *
 * Two structural reasons, and neither is a compromise:
 *
 *   1. The employment commitment is full. All 40 bytes are allocated
 *      (`src/domain/payroll/types.ts`), and the covenant splits and rebuilds
 *      the commitment at fixed offsets — adding a cadence field shifts every
 *      offset and makes every existing NFT unspendable.
 *
 *   2. Cadence is a property of the TREASURY, not of the employee.
 *      `periodsPerMonth` and `periodSeconds` are constructor arguments, so
 *      they are part of the contract's address: one treasury settles one
 *      cadence. A company paying some staff weekly and some semi-monthly funds
 *      two treasuries.
 *
 * So what this setting records is which treasury pays a given employee — the
 * kind of fact that belongs in the HRIS alongside names, positions and
 * departments, none of which fit in 40 bytes either.
 *
 * ══ WHAT CHANGING IT ACTUALLY CHANGES ═══════════════════════════════════
 *
 * The statutory engine, the schedule, whether payroll is due — and, once a
 * treasury exists for that cadence, what the chain settles. The covenant takes
 * `periodsPerMonth` as a constructor argument and divides every monthly figure
 * by it, so a treasury deployed with 4 settles a weekly payroll.
 *
 * What it cannot do is move an employee to a cadence no treasury was deployed
 * for. `periodsPerMonth` is part of the contract's address, so a company paying
 * two cadences funds two treasuries — and this setting selects which one pays
 * a given employee.
 *
 * ══ MONTHLY ═════════════════════════════════════════════════════════════
 *
 * Refused, by Article 103 of the Labor Code: wages at least once every two
 * weeks or twice a month, at intervals not exceeding sixteen days. A monthly
 * interval exceeds that in every month of the year. The database refuses it
 * too (`employees_pay_cadence_lawful_art103`), so a client that forgot the
 * rule cannot write past it.
 */

/** How the database spells the cadences. `semi-monthly` is not a valid enum label. */
type CadenceRow = 'daily' | 'weekly' | 'semi_monthly' | 'monthly'

function toRow(cadence: PayrollCadence): CadenceRow {
  return cadence === 'semi-monthly' ? 'semi_monthly' : cadence
}

function fromRow(value: string): PayrollCadence {
  const candidate = value === 'semi_monthly' ? 'semi-monthly' : value

  // A cadence this build does not know is not a reason to show a blank screen,
  // but it is a reason not to guess: fall back to the one the covenant settles.
  return isPayrollCadence(candidate) ? candidate : SEMI_MONTHLY.cadence
}

const STORAGE_KEY = 'esahod.cadence.v1'
const listeners = new Set<() => void>()

/** employeeNo → cadence. The offline mirror, and the cache the hook renders. */
let cadences: Record<number, PayrollCadence> = load<Record<number, PayrollCadence>>(STORAGE_KEY) ?? {}

function emit(): void {
  save(STORAGE_KEY, cadences)
  for (const listener of listeners) listener()
}

/** The schedule in force for an employee. Semi-monthly until told otherwise. */
export function scheduleOf(employeeNo: number): PayrollSchedule {
  return scheduleFor(cadences[employeeNo] ?? SEMI_MONTHLY.cadence)
}

/** Load every employee's cadence from the backend into the cache. */
export async function refreshCadences(): Promise<void> {
  const client = supabase()
  if (!client) return

  const { data, error } = await client.from('employees').select('employee_no, pay_cadence')
  if (error || !data) return

  const next: Record<number, PayrollCadence> = {}
  for (const row of data as { employee_no: string; pay_cadence: string }[]) {
    next[Number(row.employee_no)] = fromRow(row.pay_cadence)
  }

  cadences = next
  emit()
}

/**
 * Change an employee's cadence.
 *
 * HR only — enforced by `employees_update_hr_only`, not by hiding the control,
 * because a hidden control is a suggestion and a policy is a rule.
 */
export async function setCadence(
  employeeNo: number,
  cadence: PayrollCadence,
): Promise<{ ok: boolean; error?: string }> {
  const client = supabase()

  if (!client) {
    cadences = { ...cadences, [employeeNo]: cadence }
    emit()
    return { ok: true }
  }

  const { error } = await client
    .from('employees')
    .update({ pay_cadence: toRow(cadence) })
    .eq('employee_no', String(employeeNo))

  if (error) return { ok: false, error: friendly(error.message) }

  cadences = { ...cadences, [employeeNo]: cadence }
  emit()
  return { ok: true }
}

function friendly(message: string): string {
  if (/art103|pay_cadence_lawful/i.test(message)) {
    return 'A monthly cadence puts more than sixteen days between wage payments, which Article 103 of the Labor Code does not allow.'
  }
  if (/row-level security|permission denied/i.test(message)) {
    return 'Only HR can change an employee’s pay cadence.'
  }
  return message
}

/**
 * Load every employee's cadence and re-render when it changes.
 *
 * For screens that show a roster rather than one record. Without this,
 * `scheduleOf` answers from an empty cache and reports the default for
 * everyone — which looks exactly like a cadence setting that does nothing.
 */
export function useCadences(): { loading: boolean } {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(hasSupabase())

  useEffect(() => {
    const listener = (): void => setTick((n) => n + 1)
    listeners.add(listener)

    void refreshCadences().finally(() => setLoading(false))

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return { loading }
}

/** Subscribe a screen to the cadence of one employee. */
export function useCadence(employeeNo: number | undefined): {
  schedule: PayrollSchedule
  setSchedule: (schedule: PayrollSchedule) => Promise<{ ok: boolean; error?: string }>
  loading: boolean
} {
  const [, setTick] = useState(0)
  const [loading, setLoading] = useState(hasSupabase())

  useEffect(() => {
    const listener = (): void => setTick((n) => n + 1)
    listeners.add(listener)

    void refreshCadences().finally(() => setLoading(false))

    return () => {
      listeners.delete(listener)
    }
  }, [])

  return {
    schedule: employeeNo === undefined ? SEMI_MONTHLY : scheduleOf(employeeNo),
    setSchedule: (schedule) =>
      employeeNo === undefined
        ? Promise.resolve({ ok: false, error: 'No employee selected.' })
        : setCadence(employeeNo, schedule.cadence),
    loading,
  }
}
