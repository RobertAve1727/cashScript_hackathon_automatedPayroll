import { SEMI_MONTHLY } from '@domain/index'
import type { EmploymentCommitment } from '@domain/payroll/commitment'

/**
 * Reading the money terms out of a 40-byte commitment.
 *
 * ══ WHY taxPerPeriod NEEDS A FUNCTION AND NOT A `* 2n` ══════════════════
 *
 * `taxPerPeriod` is dimensionless on chain. The commitment stores a number of
 * centavos and nothing that says what a period is — the covenant simply sends
 * that figure to the BIR each time it pays, and the covenant pays a
 * semi-monthly period. So the field is denominated in the COVENANT's period,
 * which is `SEMI_MONTHLY`, permanently and regardless of what cadence the HRIS
 * has an employee on.
 *
 * Two screens used to write `taxPerPeriod * 2n` inline to recover a monthly
 * figure. The arithmetic was right; the bare literal was not, because it reads
 * as "two periods a month" and therefore looks like something that ought to
 * follow the employee's cadence. It must not. Following the cadence would
 * divide a daily employee's monthly tax by 22 after multiplying it by 22, which
 * cancels out — right up until someone "fixes" one half of it.
 *
 * Naming it fixes the ambiguity: this converts FROM the covenant's period,
 * which is a property of the deployed contract, not of the employee.
 */
export function monthlyTaxOf(commitment: EmploymentCommitment): bigint {
  return commitment.taxPerPeriod * BigInt(SEMI_MONTHLY.periodsPerMonth)
}

/** Monthly compensation: basic plus allowance, the base every bracket reads. */
export function monthlyCompensationOf(commitment: EmploymentCommitment): bigint {
  return commitment.monthlyBasic + commitment.monthlyAllowance
}
