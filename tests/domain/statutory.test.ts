import { describe, expect, it } from 'vitest';
import {
  computeDeductions,
  employerCost,
  monthlySalaryCredit,
  taxableCompensation,
  withholdingTaxSemiMonthly,
} from '../../src/domain/statutory/deductions.js';
import {
  FIXTURES,
  FIXTURE_ANALYST,
  FIXTURE_ENTRY_LEVEL,
  outputLayoutFor,
} from '../../src/domain/payroll/types.js';

/** ₱ helper for readable failure messages. */
const peso = (centavos: bigint): string =>
  `₱${(Number(centavos) / 100).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

describe('statutory deductions — Philippine private sector', () => {
  describe('SSS Monthly Salary Credit brackets', () => {
    // SSS is computed on a bracketed MSC, not on raw salary. This is the
    // single biggest structural difference from the government (GSIS) scheme
    // and the easiest thing to get wrong.
    it.each([
      ['below the floor', 300_000n, 500_000n],
      ['at the floor', 500_000n, 500_000n],
      ['just below the first step', 524_999n, 500_000n],
      ['exactly on the first step', 525_000n, 550_000n],
      ['top of the ₱5,500 bracket', 574_999n, 550_000n],
      ['start of the ₱6,000 bracket', 575_000n, 600_000n],
      ['mid table, exact multiple', 1_600_000n, 1_600_000n],
      ['at the ceiling', 3_500_000n, 3_500_000n],
      ['above the ceiling', 3_700_000n, 3_500_000n],
      ['far above the ceiling', 50_000_000n, 3_500_000n],
    ])('%s: %s -> MSC %s', (_case, compensation, expected) => {
      expect(monthlySalaryCredit(compensation)).toBe(expected);
    });

    it('never moves backwards as compensation rises', () => {
      let previous = 0n;
      for (let comp = 0n; comp <= 4_000_000n; comp += 12_345n) {
        const msc = monthlySalaryCredit(comp);
        expect(msc).toBeGreaterThanOrEqual(previous);
        previous = msc;
      }
    });
  });

  describe('fixture A — Systems Analyst, ₱35,000 + ₱2,000, pays tax', () => {
    const result = computeDeductions(FIXTURE_ANALYST);

    it('caps the SSS contribution at the MSC ceiling', () => {
      expect(result.sssMsc).toBe(3_500_000n); // ₱35,000 despite ₱37,000 compensation
      expect(result.sssEE).toBe(87_500n); // ₱875.00
      expect(result.sssER).toBe(175_000n); // ₱1,750.00
      expect(result.sssEC).toBe(1_500n); // ₱15.00, employer-only
      expect(result.sssTotal).toBe(264_000n); // ₱2,640.00
    });

    it('computes PhilHealth on basic salary only', () => {
      expect(result.phicEE).toBe(43_750n); // ₱437.50
      expect(result.phicTotal).toBe(87_500n); // ₱875.00
    });

    it('caps Pag-IBIG at the Maximum Fund Salary', () => {
      expect(result.hdmfEE).toBe(10_000n); // ₱100.00 — the statutory maximum
      expect(result.hdmfTotal).toBe(20_000n); // ₱200.00
    });

    it('pays the employee ₱16,065.90 net', () => {
      expect(result.gross).toBe(1_850_000n); // ₱18,500.00
      expect(result.net).toBe(1_606_590n);
      expect(peso(result.net)).toBe('₱16,065.90');
    });

    it('draws ₱20,802.50 from the treasury', () => {
      expect(result.totalDrawn).toBe(2_080_250n);
    });
  });

  describe('fixture B — Warehouse Associate, ₱16,000, zero tax', () => {
    const result = computeDeductions(FIXTURE_ENTRY_LEVEL);

    it('lands on a mid-table MSC bracket', () => {
      expect(result.sssMsc).toBe(1_600_000n);
      expect(result.sssEE).toBe(40_000n); // ₱400.00
      expect(result.sssTotal).toBe(121_500n); // ₱1,215.00 incl. ₱15 EC
    });

    it('still hits the Pag-IBIG cap, because ₱16,000 exceeds the ₱10,000 MFS', () => {
      expect(result.hdmfEE).toBe(10_000n);
      expect(result.hdmfTotal).toBe(20_000n);
    });

    it('pays the employee ₱7,300.00 net with no tax withheld', () => {
      expect(result.gross).toBe(800_000n); // ₱8,000.00
      expect(result.tax).toBe(0n);
      expect(result.net).toBe(730_000n);
    });

    it('draws ₱9,115.00 from the treasury', () => {
      expect(result.totalDrawn).toBe(911_500n);
    });
  });

  describe('the reconciliation cross-check — the slide', () => {
    // Computed a completely different way: gross pay plus every employer-side
    // contribution. It has to equal what the treasury pays out. A cross-check
    // that reuses the same expression proves nothing, so this one does not.
    it.each(FIXTURES)('$position reconciles to the centavo', (fixture) => {
      const result = computeDeductions(fixture);

      expect(employerCost(result)).toBe(result.totalDrawn);
    });

    it('reconciles ₱20,802.50 two independent ways', () => {
      const result = computeDeductions(FIXTURE_ANALYST);

      // Way 1 — what leaves the treasury, output by output.
      const outputs = result.net + result.sssTotal + result.phicTotal + result.hdmfTotal + result.tax;
      // Way 2 — gross pay plus the employer's statutory burden.
      const cost = result.gross + result.sssER + result.sssEC + result.phicER + result.hdmfER;

      expect(outputs).toBe(2_080_250n);
      expect(cost).toBe(2_080_250n);
    });

    it('holds across a wide sweep of salaries and allowances', () => {
      for (let basic = 500_000n; basic <= 12_000_000n; basic += 137_000n) {
        for (const allowance of [0n, 200_000n, 750_000n]) {
          const result = computeDeductions({ monthlyBasic: basic, monthlyAllowance: allowance, taxPerPeriod: 0n });

          expect(employerCost(result)).toBe(result.totalDrawn);
        }
      }
    });
  });

  describe('truncation parity with the covenant', () => {
    // The architecture doc warns that `x * 9 / 200` differs from
    // `x * 9 / 100 / 2`. It does not — floor(floor(a/m)/n) == floor(a/(m*n))
    // for positive integers, so nested division is safe. The warning is real
    // but the example is the wrong way round: the hazard is truncating BEFORE
    // multiplying, which is what the next test pins down.
    it('nested division is safe — chained divisors collapse exactly', () => {
      for (let x = 1n; x < 5_000_000n; x += 99_991n) {
        expect((x * 9n) / 100n / 2n).toBe((x * 9n) / 200n);
      }
    });

    it('truncating before multiplying is the real hazard', () => {
      const base = 3_501_999n;

      expect((base * 25n) / 2_000n).toBe(43_774n); // multiply first — correct
      expect((base / 2_000n) * 25n).toBe(43_750n); // divide first — 24 centavos short
    });

    it('the PhilHealth per-mille form matches the covenant per-period form', () => {
      for (let base = 1_000_000n; base <= 10_000_000n; base += 13_337n) {
        expect((base * 50n) / 4_000n).toBe((base * 25n) / 2_000n);
      }
    });

    it('never produces a fractional centavo', () => {
      for (const fixture of FIXTURES) {
        for (const amount of Object.values(computeDeductions(fixture))) {
          expect(typeof amount).toBe('bigint');
        }
      }
    });

    it('keeps every commitment field inside its byte width', () => {
      for (const fixture of FIXTURES) {
        expect(fixture.monthlyBasic).toBeLessThan(2n ** 31n); // 4-byte fields
        expect(fixture.monthlyAllowance).toBeLessThan(2n ** 31n);
        expect(fixture.taxPerPeriod).toBeLessThan(2n ** 31n);
        expect(fixture.employeeNo).toBeLessThan(2 ** 23); // 3-byte field
      }
    });
  });

  describe('the zero-tax output shift', () => {
    it('includes a BIR output when tax is owed', () => {
      const layout = outputLayoutFor(FIXTURE_ANALYST.taxPerPeriod);

      expect(layout.bir).toBe(4);
      expect(layout.employmentNft).toBe(5);
      expect(layout.treasuryChange).toBe(6);
    });

    it('omits it and shifts everything up when no tax is owed', () => {
      // A CashToken output with zero fungible units is invalid, so the BIR
      // output cannot be zero — it must not exist.
      const layout = outputLayoutFor(FIXTURE_ENTRY_LEVEL.taxPerPeriod);

      expect(layout.bir).toBeNull();
      expect(layout.employmentNft).toBe(4);
      expect(layout.treasuryChange).toBe(5);
    });

    it('leaves the four fixed recipients where they are either way', () => {
      for (const tax of [0n, 102_160n]) {
        expect(outputLayoutFor(tax)).toMatchObject({ employee: 0, sss: 1, philhealth: 2, pagibig: 3 });
      }
    });
  });

  describe('withholding tax helper (off chain only)', () => {
    it('reproduces the stored fixture figures from taxable compensation', () => {
      const analyst = computeDeductions(FIXTURE_ANALYST);
      const entry = computeDeductions(FIXTURE_ENTRY_LEVEL);

      expect(withholdingTaxSemiMonthly(taxableCompensation(analyst))).toBe(FIXTURE_ANALYST.taxPerPeriod);
      expect(withholdingTaxSemiMonthly(taxableCompensation(entry))).toBe(FIXTURE_ENTRY_LEVEL.taxPerPeriod);
    });

    it('exempts compensation at or below the ₱10,417 semi-monthly threshold', () => {
      expect(withholdingTaxSemiMonthly(1_041_700n)).toBe(0n);
      expect(withholdingTaxSemiMonthly(0n)).toBe(0n);
      expect(withholdingTaxSemiMonthly(-5_000n)).toBe(0n);
      // Just above the threshold the 15% bracket applies, but a single centavo
      // of excess still truncates to zero — tax only becomes payable further up.
      expect(withholdingTaxSemiMonthly(1_041_701n)).toBe(0n);
      expect(withholdingTaxSemiMonthly(1_100_000n)).toBeGreaterThan(0n);
    });

    it('rises monotonically with taxable compensation', () => {
      let previous = 0n;
      for (let taxable = 0n; taxable <= 40_000_000n; taxable += 250_000n) {
        const owed = withholdingTaxSemiMonthly(taxable);
        expect(owed).toBeGreaterThanOrEqual(previous);
        previous = owed;
      }
    });

    it('never takes more than the compensation it is computed on', () => {
      for (let taxable = 0n; taxable <= 40_000_000n; taxable += 311_000n) {
        expect(withholdingTaxSemiMonthly(taxable)).toBeLessThan(taxable + 1n);
      }
    });
  });
});
