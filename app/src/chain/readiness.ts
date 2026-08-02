import {
  SECONDS_PER_JULIAN_YEAR,
  SEMI_MONTHLY,
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
 * ══ THE CLOCK BELONGS TO THE TREASURY ═══════════════════════════════════
 *
 * `periodSeconds` is a constructor argument of the covenant, so it is fixed at
 * deployment and part of the contract's address. An employee's HRIS cadence
 * decides which treasury pays them; it does not change how fast that treasury's
 * clock ticks. See `esahodPeriodSeconds` below for what went wrong when this
 * module confused the two.
 *
 * Readiness is derived, never stored — there is no flag anyone can set to make
 * an employee payable early.
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

/**
 * How long one period lasts ON THE DEPLOYED TREASURY, seconds.
 *
 * ══ WHY THIS IS NOT DERIVED FROM THE EMPLOYEE'S CADENCE ═════════════════
 *
 * The covenant's rule is `tx.time >= genesisTime + period * periodSeconds`,
 * and `periodSeconds` is a CONSTRUCTOR argument — a property of the treasury,
 * fixed at deployment and baked into its address. It is not a property of the
 * employee.
 *
 * This screen used to compute the payday from the employee's HRIS cadence
 * instead, and the two are not the same number. An employee set to weekly
 * against a semi-monthly treasury got a clock ticking twice as fast as the
 * chain's: the roster offered "Run payroll" on the 3rd of July for a period
 * the network would not accept until the 17th of August, and the run failed
 * with `bad-txns-nonfinal` — six weeks early, with an error naming nothing.
 *
 * The HRIS cadence decides WHICH treasury pays an employee. This decides when
 * THIS treasury will accept a payment. Reading the second from the first is
 * how the screen came to disagree with the chain.
 */
export function esahodPeriodSeconds(schedule: PayrollSchedule): bigint {
  const configured = import.meta.env.VITE_ESAHOD_PERIOD_SECONDS

  if (configured !== undefined && configured !== '' && Number.isFinite(Number(configured))) {
    return BigInt(configured)
  }

  // No deployment configured: the demo chain has no covenant of its own, so
  // the schedule is the only clock there is.
  return periodSecondsFor(schedule)
}

/**
 * How many periods a month the DEPLOYED treasury settles.
 *
 * Derived from its `periodSeconds` rather than configured separately, so the
 * two can never disagree: a treasury paying every 1,314,873 seconds settles
 * 24 periods a year, which is semi-monthly, and there is no second value to
 * keep in sync.
 *
 * Null when no deployment is configured — the demo chain has no covenant, so
 * there is nothing for an employee's cadence to disagree with.
 */
export function deployedPeriodsPerMonth(): number | null {
  const configured = import.meta.env.VITE_ESAHOD_PERIOD_SECONDS
  if (configured === undefined || configured === '' || !Number.isFinite(Number(configured))) {
    return null
  }

  return Math.round(SECONDS_PER_JULIAN_YEAR / Number(configured) / 12)
}

/**
 * Whether an employee's HRIS cadence is one this treasury can actually settle.
 *
 * Setting someone to weekly does not make them paid weekly; it records which
 * treasury should pay them. Until a treasury deployed for that cadence exists
 * and is funded, they are paid by the one that does exist — and a roster that
 * shows the same payday for a weekly and a semi-monthly employee without
 * saying why looks like the setting is being ignored.
 */
export function cadenceMatchesTreasury(schedule: PayrollSchedule): boolean {
  const deployed = deployedPeriodsPerMonth()

  return deployed === null || deployed === schedule.periodsPerMonth
}

export function payrollReadiness(
  commitment: EmploymentCommitment,
  schedule: PayrollSchedule,
  genesisTime: bigint = esahodGenesisTime(),
  now: bigint = BigInt(Math.floor(Date.now() / 1000)),
): Readiness {
  const period = commitment.nextPeriod
  const nextPaydayAt = genesisTime + BigInt(period) * esahodPeriodSeconds(schedule)
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
      detail: `Period ${period} becomes claimable in ${humanise(secondsRemaining)} — the treasury's own clock, whatever cadence the HRIS records.`,
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
