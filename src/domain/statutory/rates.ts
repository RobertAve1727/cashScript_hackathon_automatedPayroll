/**
 * Philippine PRIVATE-SECTOR statutory contribution rates.
 *
 * Every rate the payroll depends on lives here and nowhere else, so that
 * updating a circular is a one-file change and so a judge can be shown the
 * legal basis for each number in one screen.
 *
 * This is the private-employer scheme, not the government one:
 *
 *   SSS        replaces GSIS      — RA 11199 (Social Security Act of 2018)
 *   PhilHealth same for both      — RA 11223 (Universal Health Care Act)
 *   Pag-IBIG   same for both      — RA 9679 (HDMF Law)
 *   BIR        same for both      — RA 10963 (TRAIN)
 *
 * The single biggest structural difference from the government scheme: GSIS is
 * a straight percentage of actual compensation with no ceiling, whereas **SSS
 * is computed on a bracketed Monthly Salary Credit**, not on raw salary. Two
 * employees paid ₱16,100 and ₱16,300 contribute the same amount. That bracket
 * step has to be reproduced exactly, on chain and off, or the covenant rejects
 * the transaction.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * VERIFY BEFORE THE PITCH — these are the numbers a Filipino judge will know
 * off the top of their head, and they change by circular:
 *   1. SSS contribution rate (15%) and the MSC floor/ceiling (₱5,000/₱35,000)
 *   2. The EC premium threshold (₱10 below MSC ₱15,000, ₱30 at or above)
 *   3. PhilHealth premium rate (5%) and the ₱10,000/₱100,000 income bracket
 *   4. Pag-IBIG Maximum Fund Salary (₱10,000)
 * Confirm each against the current SSS / PhilHealth / HDMF circular and adjust
 * here. Nothing else in the codebase needs to change.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * All amounts are centavos. 1 ePHP unit = 1 centavo.
 */

/** Centavos in one peso. */
export const CENTAVOS_PER_PESO = 100n;

/** Semi-monthly payroll: 24 periods a year, per Labor Code Art. 103. */
export const PERIODS_PER_YEAR = 24n;

// ── SSS — RA 11199 ────────────────────────────────────────────────────────

/** Total SSS contribution rate, in percent, of the Monthly Salary Credit. */
export const SSS_RATE_TOTAL_PERCENT = 15n;
/** Employee share of the 15%. */
export const SSS_RATE_EMPLOYEE_PERCENT = 5n;
/** Employer share of the 15%. */
export const SSS_RATE_EMPLOYER_PERCENT = 10n;

/** MSC brackets step in ₱500 increments; compensation rounds to the nearest. */
export const SSS_MSC_STEP = 50_000n; // ₱500.00
/** Lowest Monthly Salary Credit. */
export const SSS_MSC_FLOOR = 500_000n; // ₱5,000.00
/** Highest Monthly Salary Credit — the SSS contribution is capped here. */
export const SSS_MSC_CEILING = 3_500_000n; // ₱35,000.00

/**
 * Employees' Compensation premium — employer-only, a flat peso amount rather
 * than a rate, and remitted to SSS along with the contribution.
 */
export const SSS_EC_THRESHOLD_MSC = 1_500_000n; // ₱15,000.00
export const SSS_EC_MONTHLY_LOW = 1_000n; // ₱10.00
export const SSS_EC_MONTHLY_HIGH = 3_000n; // ₱30.00

// ── PhilHealth — RA 11223 ─────────────────────────────────────────────────

/** Total premium rate in per-mille of basic salary (5% = 50/1000). */
export const PHIC_RATE_TOTAL_PERMILLE = 50n;
/** Premium is shared equally between employee and employer. */
export const PHIC_INCOME_FLOOR = 1_000_000n; // ₱10,000.00
export const PHIC_INCOME_CEILING = 10_000_000n; // ₱100,000.00

// ── Pag-IBIG — RA 9679, HDMF Circular 460 ─────────────────────────────────

/** Maximum Fund Salary: contributions are computed on compensation capped here. */
export const HDMF_MAXIMUM_FUND_SALARY = 1_000_000n; // ₱10,000.00
/** Employee pays 1% at or below this compensation, 2% above it. */
export const HDMF_LOW_RATE_THRESHOLD = 150_000n; // ₱1,500.00
export const HDMF_RATE_EMPLOYEE_LOW_PERCENT = 1n;
export const HDMF_RATE_EMPLOYEE_HIGH_PERCENT = 2n;
export const HDMF_RATE_EMPLOYER_PERCENT = 2n;

// ── BIR — RA 10963 (TRAIN), semi-monthly withholding table ────────────────

/**
 * Bracket floors and the fixed amount owed at each, in centavos, for a
 * SEMI-MONTHLY period. Used only to derive figures off chain — see
 * `withholdingTaxSemiMonthly`. The covenant never computes tax.
 */
export const TRAIN_SEMI_MONTHLY_BRACKETS: readonly {
  readonly floor: bigint;
  readonly base: bigint;
  readonly ratePercent: bigint;
}[] = [
  { floor: 0n, base: 0n, ratePercent: 0n },
  { floor: 1_041_700n, base: 0n, ratePercent: 15n }, // ₱10,417.00
  { floor: 1_666_700n, base: 93_750n, ratePercent: 20n }, // ₱16,667.00
  { floor: 3_333_300n, base: 427_070n, ratePercent: 25n }, // ₱33,333.00
  { floor: 8_333_300n, base: 1_677_070n, ratePercent: 30n }, // ₱83,333.00
  { floor: 33_333_300n, base: 9_177_070n, ratePercent: 35n }, // ₱333,333.00
];
