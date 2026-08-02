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
 * On chipnet this is the `genesisTime` that `01-deploy.ts` wrote into
 * `deployment.json` and baked into the treasury's constructor — the same number
 * the covenant checks `tx.time` against. It has to come from there; a genesis
 * this app invents is a different contract's clock.
 *
 * ══ WHY THE FALLBACK IS FROZEN AT LOAD ══════════════════════════════════
 *
 * With no configured value the demo back-dates by five semi-monthly periods, so
 * a fresh clone has payable periods immediately rather than a roster nobody can
 * demonstrate for a fortnight.
 *
 * Computing that from `Date.now()` on every CALL, which this function used to
 * do, quietly destroys the thing it exists for: if genesis is always "five
 * periods ago", then payday is always the same fixed distance from now and the
 * clock never advances. A record two hours from being due would still be two
 * hours from being due tomorrow. Freezing it at module load makes time pass.
 */
const FALLBACK_GENESIS = BigInt(Math.floor(Date.now() / 1000)) - 5n * periodSecondsFor(SEMI_MONTHLY)

export function esahodGenesisTime(): bigint {
  const configured = import.meta.env.VITE_ESAHOD_GENESIS_TIME

  if (configured !== undefined && configured !== '' && Number.isFinite(Number(configured))) {
    return BigInt(configured)
  }

  return FALLBACK_GENESIS
}

/** Whether the payday clock is the deployed contract's or the demo's stand-in. */
export function genesisIsConfigured(): boolean {
  const configured = import.meta.env.VITE_ESAHOD_GENESIS_TIME

  return configured !== undefined && configured !== '' && Number.isFinite(Number(configured))
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
