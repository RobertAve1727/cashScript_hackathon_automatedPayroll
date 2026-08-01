import { describe, expect, it } from 'vitest';
import {
  DAILY,
  SEMI_MONTHLY,
  WEEKLY,
  allocateMonthlyAmount,
  allocateMonthlyAmountAcrossMonth,
  computeDeductions,
  computeScheduledDeductions,
  isLawfulCadence,
  MONTHLY_UNLAWFUL,
  monthlyObligations,
  periodOfMonth,
  scheduleMonth,
  type PayrollSchedule,
} from '../../src/domain/index.js';

/**
 * The claim under test: a company can pay every working day and still remit
 * exactly the monthly bracket SSS, PhilHealth and Pag-IBIG published — no
 * shortfall, no leftover, no accumulator to reconcile by hand at month end.
 */

const ANALYST = { monthlyBasic: 3_500_000n, monthlyAllowance: 200_000n, monthlyTax: 204_320n };
const ENTRY_LEVEL = { monthlyBasic: 1_600_000n, monthlyAllowance: 0n, monthlyTax: 0n };

function sum(values: readonly bigint[]): bigint {
  return values.reduce((total, value) => total + value, 0n);
}

describe('allocateMonthlyAmount — the running-total split', () => {
  it('sums to exactly the monthly amount at every cadence, for every amount', () => {
    // Deliberately includes amounts that divide badly: primes, odd centavos,
    // and figures smaller than the number of periods.
    const amounts = [0n, 1n, 7n, 99n, 100n, 175_000n, 250_01n, 1_750_00n, 999_999n, 1_000_003n];
    const periodCounts = [1, 2, 4, 7, 22, 26, 31];

    for (const amount of amounts) {
      for (const periods of periodCounts) {
        expect(sum(allocateMonthlyAmountAcrossMonth(amount, periods))).toBe(amount);
      }
    }
  });

  it('spreads the indivisible remainder instead of dumping it on one period', () => {
    // ₱1,750.00 over 22 working days: 79.5454… a day.
    const shares = allocateMonthlyAmountAcrossMonth(175_000n, 22);

    expect(sum(shares)).toBe(175_000n);
    // Every day is within one centavo of every other — no period carries a
    // visibly different deduction, which is what an employee would query.
    expect(Math.max(...shares.map(Number)) - Math.min(...shares.map(Number))).toBe(1);
  });

  it('is what naive division is not: 22 truncated days leave the month short', () => {
    // ₱1,750.00 of SSS ÷ 22 working days = ₱79.5454… → ₱79.54 truncated.
    const naive = (175_000n / 22n) * 22n;

    expect(naive).toBe(174_988n);
    expect(175_000n - naive).toBe(12n); // ₱0.12 under-remitted, every month
    expect(sum(allocateMonthlyAmountAcrossMonth(175_000n, 22))).toBe(175_000n);
  });

  it('rejects a period index outside the schedule', () => {
    expect(() => allocateMonthlyAmount(100n, 22, 0)).toThrow(/within 1\.\.22/);
    expect(() => allocateMonthlyAmount(100n, 22, 23)).toThrow(/within 1\.\.22/);
    expect(() => allocateMonthlyAmount(-1n, 2, 1)).toThrow(/must not be negative/);
  });
});

describe('computeScheduledDeductions — the month closes exactly, at any cadence', () => {
  const cadences: readonly PayrollSchedule[] = [DAILY, WEEKLY, SEMI_MONTHLY];

  for (const schedule of cadences) {
    it(`${schedule.cadence}: every statutory total sums to the published monthly figure`, () => {
      const month = scheduleMonth({ ...ANALYST, schedule });
      const monthly = monthlyObligations(ANALYST.monthlyBasic, ANALYST.monthlyAllowance);

      expect(month).toHaveLength(schedule.periodsPerMonth);
      expect(sum(month.map((p) => p.sssEE))).toBe(monthly.sssEE);
      expect(sum(month.map((p) => p.sssER))).toBe(monthly.sssER);
      expect(sum(month.map((p) => p.sssEC))).toBe(monthly.sssEC);
      expect(sum(month.map((p) => p.phicEE))).toBe(monthly.phicEE);
      expect(sum(month.map((p) => p.phicER))).toBe(monthly.phicER);
      expect(sum(month.map((p) => p.hdmfEE))).toBe(monthly.hdmfEE);
      expect(sum(month.map((p) => p.hdmfER))).toBe(monthly.hdmfER);
      expect(sum(month.map((p) => p.tax))).toBe(ANALYST.monthlyTax);
      expect(sum(month.map((p) => p.gross))).toBe(monthly.monthlyCompensation);
    });

    it(`${schedule.cadence}: net pay over the month equals gross less the employee's own shares`, () => {
      const month = scheduleMonth({ ...ENTRY_LEVEL, schedule });
      const monthly = monthlyObligations(ENTRY_LEVEL.monthlyBasic, ENTRY_LEVEL.monthlyAllowance);

      expect(sum(month.map((p) => p.net))).toBe(
        monthly.monthlyCompensation - monthly.sssEE - monthly.phicEE - monthly.hdmfEE - ENTRY_LEVEL.monthlyTax,
      );
    });
  }

  it('daily payroll draws the same total from the treasury as semi-monthly does', () => {
    // The cadence changes when money moves, never how much. This is the
    // property that makes switching schedules a business decision rather than
    // a repricing of every employee.
    const daily = sum(scheduleMonth({ ...ANALYST, schedule: DAILY }).map((p) => p.totalDrawn));
    const weekly = sum(scheduleMonth({ ...ANALYST, schedule: WEEKLY }).map((p) => p.totalDrawn));
    const semiMonthly = sum(scheduleMonth({ ...ANALYST, schedule: SEMI_MONTHLY }).map((p) => p.totalDrawn));

    expect(daily).toBe(semiMonthly);
    expect(weekly).toBe(semiMonthly);
  });
});

describe('absence reduces the wage and never the statutory obligation', () => {
  it('an unworked day costs the employee that day, and costs the funds nothing', () => {
    const present = computeScheduledDeductions({ ...ANALYST, schedule: DAILY, periodOfMonth: 5 });
    const absent = computeScheduledDeductions({
      ...ANALYST,
      schedule: DAILY,
      periodOfMonth: 5,
      periodsWorked: 0,
    });

    expect(absent.gross).toBe(0n);
    expect(present.gross).toBeGreaterThan(0n);

    // SSS, PhilHealth and Pag-IBIG are owed on the monthly salary credit for
    // the month, not per day attended. Remitting less because someone took
    // leave is under-remittance.
    expect(absent.sssTotal).toBe(present.sssTotal);
    expect(absent.phicTotal).toBe(present.phicTotal);
    expect(absent.hdmfTotal).toBe(present.hdmfTotal);
  });

  it('a half day pays half the wage', () => {
    const full = computeScheduledDeductions({ ...ANALYST, schedule: DAILY, periodOfMonth: 3 });
    const half = computeScheduledDeductions({
      ...ANALYST,
      schedule: DAILY,
      periodOfMonth: 3,
      periodsWorked: 0.5,
    });

    expect(half.gross).toBe(full.gross / 2n);
  });

  it('refuses a fraction outside one period', () => {
    expect(() =>
      computeScheduledDeductions({ ...ANALYST, schedule: DAILY, periodOfMonth: 1, periodsWorked: 1.5 }),
    ).toThrow(/fraction of one period/);
  });
});

describe('agreement with the covenant path, and where it deliberately differs', () => {
  it('semi-monthly period 1 matches what the deployed covenant enforces', () => {
    const covenant = computeDeductions({
      monthlyBasic: ANALYST.monthlyBasic,
      monthlyAllowance: ANALYST.monthlyAllowance,
      taxPerPeriod: ANALYST.monthlyTax / 2n,
    });
    const scheduled = computeScheduledDeductions({ ...ANALYST, schedule: SEMI_MONTHLY, periodOfMonth: 1 });

    expect(scheduled.gross).toBe(covenant.gross);
    expect(scheduled.sssEE).toBe(covenant.sssEE);
    expect(scheduled.sssER).toBe(covenant.sssER);
    expect(scheduled.sssEC).toBe(covenant.sssEC);
    expect(scheduled.phicEE).toBe(covenant.phicEE);
    expect(scheduled.hdmfEE).toBe(covenant.hdmfEE);
    expect(scheduled.hdmfER).toBe(covenant.hdmfER);
    expect(scheduled.totalDrawn).toBe(covenant.totalDrawn);
  });

  it('THE ONE-CENTAVO FINDING: a period-invariant covenant under-remits an odd monthly premium', () => {
    // PhilHealth is 2.5% of an arbitrary basic salary, so its monthly employee
    // premium can be an odd number of centavos. ₱10,000.40 basic gives
    // ₱250.01 a month, which no pair of equal cut-offs can sum to.
    const oddBasic = 1_000_040n;
    const monthly = monthlyObligations(oddBasic, 0n);
    expect(monthly.phicEE).toBe(25_001n);
    expect(monthly.phicEE % 2n).toBe(1n);

    // The covenant pays an identical amount every cut-off, by construction.
    const covenant = computeDeductions({
      monthlyBasic: oddBasic,
      monthlyAllowance: 0n,
      taxPerPeriod: 0n,
    });
    expect(covenant.phicEE * 2n).toBe(25_000n);
    expect(monthly.phicEE - covenant.phicEE * 2n).toBe(1n); // one centavo short, every month

    // The scheduled engine puts that centavo on a real period instead.
    const month = scheduleMonth({ monthlyBasic: oddBasic, monthlyAllowance: 0n, monthlyTax: 0n, schedule: SEMI_MONTHLY });
    expect(sum(month.map((p) => p.phicEE))).toBe(25_001n);
    expect(month.map((p) => p.phicEE)).toEqual([12_500n, 12_501n]);
  });

  it('SSS never exhibits it — the MSC is always a multiple of ₱500', () => {
    for (let compensation = 400_000n; compensation <= 4_000_000n; compensation += 37_000n) {
      const monthly = monthlyObligations(compensation, 0n);
      expect(monthly.sssEE % 2n).toBe(0n);
      expect(monthly.sssER % 2n).toBe(0n);
    }
  });
});

describe('the schedule model', () => {
  it('maps the NFT’s monotonic counter onto the month it belongs to', () => {
    // The commitment counter only ever increases; statutory allocation restarts
    // each month because the obligation itself is monthly.
    expect(periodOfMonth(0, SEMI_MONTHLY)).toBe(1);
    expect(periodOfMonth(1, SEMI_MONTHLY)).toBe(2);
    expect(periodOfMonth(2, SEMI_MONTHLY)).toBe(1); // next month
    expect(periodOfMonth(21, DAILY)).toBe(22);
    expect(periodOfMonth(22, DAILY)).toBe(1);
  });

  it('holds Article 103 as data: monthly-only fails the 16-day interval', () => {
    expect(isLawfulCadence(MONTHLY_UNLAWFUL)).toBe(false);
    expect(isLawfulCadence(SEMI_MONTHLY)).toBe(true);
    expect(isLawfulCadence(WEEKLY)).toBe(true);
    expect(isLawfulCadence(DAILY)).toBe(true);
  });

  it('states honestly which cadence the deployed covenant actually settles', () => {
    // Exactly one, so no screen can claim on-chain support the contract lacks.
    const settled = [DAILY, WEEKLY, SEMI_MONTHLY].filter((s) => s.settledByDeployedCovenant);

    expect(settled).toEqual([SEMI_MONTHLY]);
  });
});
