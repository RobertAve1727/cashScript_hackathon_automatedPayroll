import type { DeductionInput } from '../statutory/deductions.js';

/**
 * THE LOCKED SEAMS — backlog task T01.
 *
 * The four decisions every other file depends on. Nothing parallelises until
 * these are agreed, so they live in one file the whole team can point at:
 *
 *   1. the 40-byte employment commitment layout, with exact offsets
 *   2. the `computeDeductions()` signature — all `bigint`, all centavos
 *      (see `../statutory/deductions.ts`)
 *   3. the transaction output order, including the BIR-disappears rule
 *   4. the two fixture employees
 *
 * Changing anything here breaks the covenant, the transaction builder and the
 * payslip screen simultaneously. Change it out loud.
 */

// ── 1. The 40-byte employment commitment ─────────────────────────────────

/**
 * CashTokens caps an NFT commitment at 40 bytes. The layout uses all of them.
 *
 * This is the employment record for a private-sector employee — the digital
 * form of the employment contract. `payeePkh` sits INSIDE the commitment
 * rather than in the contract parameters, which is what makes triggering
 * payroll safe to give away: the payroll officer can run a 5,000-employee
 * batch and remains mathematically unable to redirect a single centavo.
 *
 * Values are read with CashScript's `int()` cast: little-endian, signed.
 * Keep 4-byte fields under 2^31 (₱21.4M/month) and 2-byte fields under 2^15.
 */
export const COMMITMENT_LAYOUT = {
  /** Employee's wallet P2PKH hash — the reason triggering is safe to delegate. */
  payeePkh: { offset: 0, bytes: 20 },
  /** Monthly basic salary, centavos. */
  monthlyBasic: { offset: 20, bytes: 4 },
  /** Monthly allowances forming part of compensation, centavos. */
  monthlyAllowance: { offset: 24, bytes: 4 },
  /** Withholding tax per period, computed and stored by HR. */
  taxPerPeriod: { offset: 28, bytes: 4 },
  /** Monotonic counter. THE anti-double-payment mechanism. */
  nextPeriod: { offset: 32, bytes: 2 },
  /** Last payable period — fixed-term and project-based contracts expire on their own. */
  endPeriod: { offset: 34, bytes: 2 },
  /** 1 = active, 0 = suspended or separated. */
  status: { offset: 36, bytes: 1 },
  /** Company employee number, for the audit trail. */
  employeeNo: { offset: 37, bytes: 3 },
} as const satisfies Record<string, { offset: number; bytes: number }>;

/** Consensus limit, and exactly what the layout above adds up to. */
export const COMMITMENT_BYTES = 40;

export const EMPLOYMENT_STATUS_ACTIVE = 1;
export const EMPLOYMENT_STATUS_INACTIVE = 0;

// ── 3. The transaction output order ──────────────────────────────────────

/**
 * A payroll transaction pays five parties at once. The deduction and the
 * remittance are the same event — that is the entire thesis of the project.
 *
 *   0  employee    net pay
 *   1  SSS         employee + employer share + EC premium
 *   2  PhilHealth  employee + employer share
 *   3  Pag-IBIG    employee + employer share
 *   4  BIR         withholding tax        ← OMITTED when tax is zero
 *   5  employment NFT, period advanced by one
 *   6  treasury change
 *   7+ BCH change (optional)
 *
 * The zero-tax branch is not a nicety. A CashToken output carrying zero
 * fungible units is INVALID, so when an employee owes no withholding tax the
 * BIR output cannot simply be zero — it must not exist, and everything after
 * it shifts up by one. Minimum-wage earners are exempt from income tax under
 * RA 9504, so this is the common case, not the edge case.
 */
export const OUTPUT_EMPLOYEE = 0;
export const OUTPUT_SSS = 1;
export const OUTPUT_PHILHEALTH = 2;
export const OUTPUT_PAGIBIG = 3;
export const OUTPUT_BIR = 4;

export interface OutputLayout {
  readonly employee: number;
  readonly sss: number;
  readonly philhealth: number;
  readonly pagibig: number;
  /** `null` when the employee owes no withholding tax. */
  readonly bir: number | null;
  readonly employmentNft: number;
  readonly treasuryChange: number;
}

/** Resolve the output indices for a period, applying the zero-tax shift. */
export function outputLayoutFor(taxPerPeriod: bigint): OutputLayout {
  const taxed = taxPerPeriod > 0n;

  return {
    employee: OUTPUT_EMPLOYEE,
    sss: OUTPUT_SSS,
    philhealth: OUTPUT_PHILHEALTH,
    pagibig: OUTPUT_PAGIBIG,
    bir: taxed ? OUTPUT_BIR : null,
    employmentNft: taxed ? 5 : 4,
    treasuryChange: taxed ? 6 : 5,
  };
}

// ── 4. The two fixture employees ─────────────────────────────────────────

export interface FixtureEmployee extends DeductionInput {
  readonly employeeNo: number;
  /**
   * Name in parts. One string cannot be taken apart again reliably — "Jun
   * Dela Cruz" has a two-word surname — and every statutory form asks for the
   * parts separately, so they are stored that way and joined for display.
   */
  readonly firstName: string;
  readonly middleName?: string;
  readonly lastName: string;
  readonly position: string;
  readonly note: string;
}

/** "Maria Cruz Santos" — the parts joined, for anywhere a label is wanted. */
export function fixtureFullName(employee: FixtureEmployee): string {
  return [employee.firstName, employee.middleName, employee.lastName].filter(Boolean).join(' ');
}

/**
 * Everything in this repo is tested against these two people.
 *
 * They are chosen to exercise every branch between them: the SSS MSC ceiling
 * and a mid-table bracket, the Pag-IBIG Maximum Fund Salary cap, and both
 * sides of the zero-tax output shift.
 */
export const FIXTURE_ANALYST: FixtureEmployee = {
  employeeNo: 1001,
  firstName: 'Maria',
  middleName: 'Cruz',
  lastName: 'Santos',
  position: 'Systems Analyst',
  monthlyBasic: 3_500_000n, // ₱35,000.00
  monthlyAllowance: 200_000n, // ₱2,000.00
  taxPerPeriod: 102_160n, // ₱1,021.60 — HR-computed, stored in the NFT
  note: 'Compensation ₱37,000 sits above the ₱35,000 MSC ceiling, so the SSS contribution caps. Pays withholding tax, so the BIR output is present.',
};

export const FIXTURE_ENTRY_LEVEL: FixtureEmployee = {
  employeeNo: 1002,
  firstName: 'Jun',
  lastName: 'Dela Cruz',
  position: 'Warehouse Associate',
  monthlyBasic: 1_600_000n, // ₱16,000.00
  monthlyAllowance: 0n,
  taxPerPeriod: 0n, // below the ₱10,417 semi-monthly threshold
  note: 'Lands on a mid-table MSC bracket, the Pag-IBIG cap binds, and zero withholding tax removes the BIR output — outputs 5 and 6 shift to 4 and 5.',
};

export const FIXTURES: readonly FixtureEmployee[] = [FIXTURE_ANALYST, FIXTURE_ENTRY_LEVEL];
