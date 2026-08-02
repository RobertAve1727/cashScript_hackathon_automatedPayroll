import {
  SEMI_MONTHLY,
  payableAt,
  periodSecondsFor,
  type PayrollSchedule,
} from '@domain/index'
import type { EmploymentCommitment } from '@domain/payroll/commitment'
import { EMPLOYMENT_STATUS_ACTIVE } from '@domain/payroll/types'

/**
 * Whether an employee is due to be paid, and when they next will be.
 *
 * ══ WHY THIS EXISTS ═════════════════════════════════════════════════════
 *
 * Until now the app had no concept of payday at all. `Run payroll` fired
 * whenever it was clicked, and the roster's "payable employees" tile counted
 * anyone active whose contract window had not run out. The only real due-check
 * in the project lived in `scripts/esahod/payroll-daemon.ts`.
 *
 * That gap matters more than it looks. The covenant's single temporal rule is
 *
 *     require(tx.time >= genesisTime + period * periodSeconds,
 *             "payday for this period has not arrived")
 *
 * so a UI that offers a run before that moment is offering a transaction the
 * chain will reject. Worse, it is offering it in the demo where a judge is
 * watching. This module is the same arithmetic as the covenant and as the
 * daemon, in the one place the screens can ask.
 *
 * ══ CADENCE IS WHAT MAKES IT MOVE ═══════════════════════════════════════
 *
 * `periodSecondsFor(schedule)` is the whole reason changing an employee's
 * cadence changes anything a person can see: shorten the period and the next
 * payday moves closer, so a record that was not due becomes due. That is what
 * "payroll ready" means here, and it is derived, never stored — there is no
 * flag anyone can set to make an employee payable early.
 */

export type ReadinessReason = 'due' | 'not-yet' | 'suspended' | 'window-exhausted'

export interface Readiness {
  readonly due: boolean
  readonly reason: ReadinessReason
  /** The period this employee is next owed. */
  readonly period: number
  /** When that period becomes claimable, unix seconds. */
  readonly nextPaydayAt: bigint
  /** Seconds until then; zero once it has arrived. */
  readonly secondsRemaining: bigint
  /** One sentence, for a screen to show as-is. */
  readonly detail: string
}

/**
 * When the treasury's period counter started.
 *
 * On chipnet this is written into `deployment.json` by `01-deploy.ts` and
 * passed in through the environment. Offline the demo back-dates it by five
 * semi-monthly periods, exactly as the deploy script does, so a fresh clone has
 * payable periods immediately instead of a roster that cannot be demonstrated
 * until a fortnight has passed.
 */
export function esahodGenesisTime(): bigint {
  const configured = import.meta.env.VITE_ESAHOD_GENESIS_TIME

  if (configured !== undefined && configured !== '' && Number.isFinite(Number(configured))) {
    return BigInt(configured)
  }

  const now = BigInt(Math.floor(Date.now() / 1000))

  return now - 5n * periodSecondsFor(SEMI_MONTHLY)
}

export function payrollReadiness(
  commitment: EmploymentCommitment,
  schedule: PayrollSchedule,
  genesisTime: bigint = esahodGenesisTime(),
  now: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Readiness {
  const period = commitment.nextPeriod
  const nextPaydayAt = payableAt(genesisTime, period, schedule)
  const secondsRemaining = nextPaydayAt > now ? nextPaydayAt - now : 0n

  // Status and window first: an employee who is suspended is not "due in three
  // days", they are not due at all, and reporting a countdown for them would
  // be a promise the covenant will not keep.
  if (commitment.status !== EMPLOYMENT_STATUS_ACTIVE) {
    return {
      due: false,
      reason: 'suspended',
      period,
      nextPaydayAt,
      secondsRemaining,
      detail: 'Suspended or separated — the covenant refuses to pay a record whose status is not active.',
    }
  }

  if (commitment.nextPeriod > commitment.endPeriod) {
    return {
      due: false,
      reason: 'window-exhausted',
      period,
      nextPaydayAt,
      secondsRemaining,
      detail: `The contract window is used up: period ${commitment.nextPeriod} is past the agreed end at ${commitment.endPeriod}.`,
    }
  }

  if (secondsRemaining > 0n) {
    return {
      due: false,
      reason: 'not-yet',
      period,
      nextPaydayAt,
      secondsRemaining,
      detail: `Period ${period} becomes claimable in ${humanise(secondsRemaining)}, on the ${schedule.cadence} schedule.`,
    }
  }

  return {
    due: true,
    reason: 'due',
    period,
    nextPaydayAt,
    secondsRemaining: 0n,
    detail: `Period ${period} is payable now. Anyone may broadcast it — the covenant fixes every payee and every amount.`,
  }
}

/** Coarse on purpose: a payday countdown to the second reads as a stopwatch. */
function humanise(seconds: bigint): string {
  const days = seconds / 86_400n
  if (days > 0n) return `${days} day${days === 1n ? '' : 's'}`

  const hours = seconds / 3_600n
  if (hours > 0n) return `${hours} hour${hours === 1n ? '' : 's'}`

  const minutes = seconds / 60n
  return `${minutes} minute${minutes === 1n ? '' : 's'}`
}

/** Local date and time of a unix second, for a screen. */
export function formatPayday(unixSeconds: bigint): string {
  return new Date(Number(unixSeconds) * 1000).toLocaleString('en-PH', {
    timeZone: 'Asia/Manila',
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}
