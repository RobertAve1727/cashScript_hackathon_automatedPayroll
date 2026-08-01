import {
  HDMF_LOW_RATE_THRESHOLD,
  HDMF_MAXIMUM_FUND_SALARY,
  HDMF_RATE_EMPLOYEE_HIGH_PERCENT,
  HDMF_RATE_EMPLOYEE_LOW_PERCENT,
  HDMF_RATE_EMPLOYER_PERCENT,
  PHIC_INCOME_CEILING,
  PHIC_INCOME_FLOOR,
  PHIC_RATE_TOTAL_PERMILLE,
  SSS_EC_MONTHLY_HIGH,
  SSS_EC_MONTHLY_LOW,
  SSS_EC_THRESHOLD_MSC,
  SSS_MSC_CEILING,
  SSS_MSC_FLOOR,
  SSS_MSC_STEP,
  SSS_RATE_EMPLOYEE_PERCENT,
  SSS_RATE_EMPLOYER_PERCENT,
  TRAIN_SEMI_MONTHLY_BRACKETS,
} from './rates.js';

/**
 * The statutory engine for one semi-monthly cut-off, private sector.
 *
 * ══ THE RULE THAT MATTERS MORE THAN ANY OTHER IN THIS FILE ══════════════
 *
 * Every expression here must mirror the covenant's arithmetic CHARACTER FOR
 * CHARACTER. `x * 5n / 200n` is NOT `x * 5n / 100n / 2n` — the second
 * truncates twice and drifts by a centavo. When it drifts, the covenant
 * rejects the transaction and the error message tells you nothing useful.
 *
 * `bigint` division truncates toward zero, which is what CashScript's `int`
 * division does for positive values, so the two agree by construction as long
 * as the expressions are written identically. Never introduce a `Number`, a
 * `Math.round`, or an intermediate division that the covenant does not have.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Three funds, three different bases — this is the part that is easy to get
 * wrong and the part judges will probe:
 *
 *   SSS         a BRACKETED Monthly Salary Credit derived from total
 *               compensation, floored at ₱5,000 and capped at ₱35,000
 *   PhilHealth  BASIC salary only, floored at ₱10,000, capped at ₱100,000
 *   Pag-IBIG    total compensation, capped at the ₱10,000 Maximum Fund Salary
 *
 * All amounts are centavos.
 */

export interface DeductionInput {
  /** Monthly basic salary, centavos. */
  readonly monthlyBasic: bigint;
  /** Monthly allowances treated as part of compensation, centavos. */
  readonly monthlyAllowance: bigint;
  /**
   * Withholding tax for this period, computed by HR and stored in the
   * employment NFT. The covenant enforces exactly this number to exactly the
   * BIR address — it never computes it. See `withholdingTaxSemiMonthly`.
   */
  readonly taxPerPeriod: bigint;
}

export interface Deductions {
  /** Monthly basic + allowance. The base for SSS and Pag-IBIG. */
  readonly monthlyCompensation: bigint;
  /** Gross pay for this period — half of monthly compensation. */
  readonly gross: bigint;

  /** The bracketed Monthly Salary Credit the SSS contribution is computed on. */
  readonly sssMsc: bigint;
  readonly sssEE: bigint;
  readonly sssER: bigint;
  /** Employees' Compensation premium, employer-only, flat. */
  readonly sssEC: bigint;
  /** What lands at the SSS address: employee + employer + EC. */
  readonly sssTotal: bigint;

  readonly phicEE: bigint;
  readonly phicER: bigint;
  readonly phicTotal: bigint;

  readonly hdmfEE: bigint;
  readonly hdmfER: bigint;
  readonly hdmfTotal: bigint;

  /** Passed straight through from the NFT commitment. */
  readonly tax: bigint;

  /** What the employee receives. */
  readonly net: bigint;
  /** Everything that leaves the treasury: net + all four remittances. */
  readonly totalDrawn: bigint;
}

/**
 * Round compensation to its SSS bracket.
 *
 * SSS publishes a table in ₱500 steps: ₱5,250–₱5,749.99 all map to an MSC of
 * ₱5,500. Adding half a step before truncating is round-half-up, which
 * reproduces the published table exactly and is one comparison and two
 * arithmetic ops in the covenant.
 */
export function monthlySalaryCredit(monthlyCompensation: bigint): bigint {
  const rounded = ((monthlyCompensation + SSS_MSC_STEP / 2n) / SSS_MSC_STEP) * SSS_MSC_STEP;

  if (rounded < SSS_MSC_FLOOR) return SSS_MSC_FLOOR;
  if (rounded > SSS_MSC_CEILING) return SSS_MSC_CEILING;

  return rounded;
}

/**
 * The whole payroll calculation for one employee, one cut-off.
 *
 * Deliberately pure: no clock, no chain, no I/O. It is the specification the
 * covenant, the transaction builder and the payslip screen are all checked
 * against, so it must be reproducible from its inputs alone.
 */
export function computeDeductions(input: DeductionInput): Deductions {
  const { monthlyBasic, monthlyAllowance, taxPerPeriod } = input;
  const monthlyCompensation = monthlyBasic + monthlyAllowance;

  // ── SSS ── bracketed MSC, half of the monthly contribution per cut-off.
  const sssMsc = monthlySalaryCredit(monthlyCompensation);
  const sssEE = (sssMsc * SSS_RATE_EMPLOYEE_PERCENT) / 200n;
  const sssER = (sssMsc * SSS_RATE_EMPLOYER_PERCENT) / 200n;
  const sssEC = (sssMsc >= SSS_EC_THRESHOLD_MSC ? SSS_EC_MONTHLY_HIGH : SSS_EC_MONTHLY_LOW) / 2n;
  const sssTotal = sssEE + sssER + sssEC;

  // ── PhilHealth ── basic salary only, with both a floor and a ceiling.
  let phicBase = monthlyBasic;
  if (phicBase < PHIC_INCOME_FLOOR) phicBase = PHIC_INCOME_FLOOR;
  if (phicBase > PHIC_INCOME_CEILING) phicBase = PHIC_INCOME_CEILING;
  // Half the 5% premium is the employee's, and half of that falls due per
  // cut-off: rate/1000 * 1/2 (share) * 1/2 (period) == rate/4000.
  const phicEE = (phicBase * PHIC_RATE_TOTAL_PERMILLE) / 4_000n;
  const phicER = phicEE;
  const phicTotal = phicEE + phicER;

  // ── Pag-IBIG ── capped at the Maximum Fund Salary; the employee rate drops
  // to 1% at or below ₱1,500 of compensation while the employer stays at 2%.
  let hdmfBase = monthlyCompensation;
  if (hdmfBase > HDMF_MAXIMUM_FUND_SALARY) hdmfBase = HDMF_MAXIMUM_FUND_SALARY;
  const hdmfEmployeeRate =
    monthlyCompensation <= HDMF_LOW_RATE_THRESHOLD
      ? HDMF_RATE_EMPLOYEE_LOW_PERCENT
      : HDMF_RATE_EMPLOYEE_HIGH_PERCENT;
  const hdmfEE = (hdmfBase * hdmfEmployeeRate) / 200n;
  const hdmfER = (hdmfBase * HDMF_RATE_EMPLOYER_PERCENT) / 200n;
  const hdmfTotal = hdmfEE + hdmfER;

  // ── Net and the treasury draw ──
  const gross = monthlyCompensation / 2n;
  const tax = taxPerPeriod;
  const net = gross - sssEE - phicEE - hdmfEE - tax;
  const totalDrawn = net + sssTotal + phicTotal + hdmfTotal + tax;

  return {
    monthlyCompensation,
    gross,
    sssMsc,
    sssEE,
    sssER,
    sssEC,
    sssTotal,
    phicEE,
    phicER,
    phicTotal,
    hdmfEE,
    hdmfER,
    hdmfTotal,
    tax,
    net,
    totalDrawn,
  };
}

/**
 * The employer's true cost for this employee this period, computed a
 * completely different way: gross pay plus every employer-side contribution.
 *
 * It must equal `totalDrawn`. That equality is the reconciliation slide, and
 * it is asserted independently in the tests rather than derived from the same
 * expression — a cross-check that shares its arithmetic proves nothing.
 */
export function employerCost(deductions: Deductions): bigint {
  return (
    deductions.gross + deductions.sssER + deductions.sssEC + deductions.phicER + deductions.hdmfER
  );
}

/**
 * TRAIN semi-monthly withholding, for deriving fixture and UI figures ONLY.
 *
 * This is deliberately NOT what the covenant enforces. Real withholding is
 * annualised, depends on substituted filing, year-to-date compensation and the
 * taxability of specific allowances, and minimum-wage earners are exempt
 * outright under RA 9504. HR computes the real number and writes it into the
 * NFT; the chain enforces that exact number to exactly the BIR address.
 *
 * Knowing where that boundary sits — enforcing what is verifiable, refusing to
 * pretend the rest is — is the point, and it is worth saying out loud on stage.
 */
export function withholdingTaxSemiMonthly(taxableCompensation: bigint): bigint {
  if (taxableCompensation <= 0n) return 0n;

  let owed = 0n;
  for (const bracket of TRAIN_SEMI_MONTHLY_BRACKETS) {
    if (taxableCompensation <= bracket.floor) break;
    owed = bracket.base + ((taxableCompensation - bracket.floor) * bracket.ratePercent) / 100n;
  }

  return owed;
}

/** Compensation subject to withholding: gross less the employee's own share. */
export function taxableCompensation(deductions: Deductions): bigint {
  return deductions.gross - deductions.sssEE - deductions.phicEE - deductions.hdmfEE;
}
