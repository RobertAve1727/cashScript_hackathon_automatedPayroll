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
 * ══ WHY THIS IS NOT ON CHAIN, AND WHY THAT IS NOT A COMPROMISE ══════════
 *
 * It cannot be. Two independent reasons, both structural:
 *
 *   1. The employment commitment is full. All 40 bytes are allocated
 *      (`src/domain/payroll/types.ts`), and the covenant splits and rebuilds
 *      the commitment at fixed offsets — adding a cadence field shifts every
 *      offset and makes every existing NFT unspendable.
 *
 *   2. `periodSeconds` is a constructor argument of `PayrollTreasury`, so it
 *      is part of the contract's address preimage. A different cadence is a
 *      different treasury address holding different funds. Cadence cannot vary
 *      per employee within one treasury; it is a property of the deployment.
 *
 * So cadence lives here, in the HRIS, where the rest of the employment
 * relationship that does not fit in 40 bytes already lives — names, positions,
 * departments, attendance.
 *
 * ══ WHAT CHANGING IT ACTUALLY CHANGES ═══════════════════════════════════
 *
 * The statutory engine, the schedule, and whether payroll is due. What it does
 * NOT change is what the deployed covenant settles: that contract computes
 * `gross = monthlyCompensation / 2` and halves every statutory divisor, so it
 * pays a semi-monthly period and nothing else, whatever this setting says.
 *
 * `PayrollSchedule.settledByDeployedCovenant` is the one place that
 * distinction is recorded, and every screen that offers a cadence is required
 * to show it. Setting an employee to daily makes the engine, the reconciliation
 * and the payday clock daily; making the CHAIN daily is a covenant redeploy
 * with two changed constants and a fresh treasury address.
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
