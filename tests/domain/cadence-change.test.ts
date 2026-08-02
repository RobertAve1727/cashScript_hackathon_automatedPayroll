import { describe, expect, it } from 'vitest';
import {
  DAILY,
  MONTHLY_UNLAWFUL,
  SECONDS_PER_JULIAN_YEAR,
  SELECTABLE_SCHEDULES,
  SEMI_MONTHLY,
  WEEKLY,
  isPayableNow,
  isPayrollCadence,
  monthlyObligations,
  payableAt,
  periodSecondsFor,
  periodsPerYear,
  rescaleEndPeriod,
  rescaleTaxPerPeriod,
  scheduleFor,
  scheduleMonth,
} from '../../src/domain/index.js';

/**
 * The claim under test: HR can move an employee between pay cadences, and
 * everything that follows from that — when they are next payable, what the
 * month remits, what their on-chain record would have to say — moves with it
 * and stays exact.
 *
 * The dangerous half of this feature is not the arithmetic, it is the things a
 * cadence change does NOT update on its own. Two fields of the 40-byte
 * commitment are denominated in periods, and a period means something
 * different after the change. Those are pinned here as hard as the allocation.
 */

const ANALYST = { monthlyBasic: 3_500_000n, monthlyAllowance: 200_000n, monthlyTax: 204_320n };

/** The constant `01-deploy.ts` and `tests/support/esahod.ts` both hardcode. */
const DEPLOYED_PERIOD_SECONDS = 1_314_873n;

describe('resolving a cadence that arrived as a string', () => {
  it('round-trips every schedule the domain models', () => {
    for (const schedule of [DAILY, WEEKLY, SEMI_MONTHLY, MONTHLY_UNLAWFUL]) {
      expect(scheduleFor(schedule.cadence)).toBe(schedule);
    }
  });

  it('refuses a string that is not a cadence, naming it', () => {
    // Cadence crosses a process boundary — it is stored, sent and read back —
    // so the failure has to happen at the boundary with the offending value in
    // hand, not three layers later as a division by undefined.
    expect(() => scheduleFor('fortnightly' as never)).toThrow(/fortnightly/);
    expect(isPayrollCadence('fortnightly')).toBe(false);
    expect(isPayrollCadence('semi-monthly')).toBe(true);
  });
});

describe('period length', () => {
  it('derives exactly the periodSeconds the treasury was deployed with', () => {
    // If this drifts, the app's payday clock and the covenant's `tx.time`
    // check disagree, and the UI offers runs the chain will reject.
    expect(periodSecondsFor(SEMI_MONTHLY)).toBe(DEPLOYED_PERIOD_SECONDS);
    expect(BigInt(SECONDS_PER_JULIAN_YEAR) / 24n).toBe(DEPLOYED_PERIOD_SECONDS);
  });

  it('keeps every lawful cadence inside Article 103’s sixteen-day maximum', () => {
    const sixteenDays = 16n * 86_400n;

    for (const schedule of SELECTABLE_SCHEDULES) {
      expect(periodSecondsFor(schedule)).toBeLessThanOrEqual(sixteenDays);
    }

    // And the one that is not offered fails it, which is why it is not offered.
    expect(periodSecondsFor(MONTHLY_UNLAWFUL)).toBeGreaterThan(sixteenDays);
  });

  it('counts a weekly year as 48 periods, not 52, and that is deliberate', () => {
    // 52 weeks do not divide 12 months, so a 52-period year would leave every
    // month reconciling against a fraction of a week. Four periods a month
    // keeps the monthly allocation exact; paydays land 7.6 days apart.
    expect(periodsPerYear(WEEKLY)).toBe(48);
    expect(Number(periodSecondsFor(WEEKLY)) / 86_400).toBeCloseTo(7.6, 1);
  });
});

describe('when a period becomes claimable', () => {
  const genesis = 1_700_000_000n;

  it('is the covenant’s own rule: genesisTime + period * periodSeconds', () => {
    expect(payableAt(genesis, 0, SEMI_MONTHLY)).toBe(genesis);
    expect(payableAt(genesis, 3, SEMI_MONTHLY)).toBe(genesis + 3n * DEPLOYED_PERIOD_SECONDS);
  });

  it('brings the next payday forward when the cadence shortens', () => {
    // This is the whole point of the setting: the same period number on a
    // faster cadence is claimable sooner.
    expect(payableAt(genesis, 1, DAILY)).toBeLessThan(payableAt(genesis, 1, SEMI_MONTHLY));
  });

  it('turns a not-yet-due record into a due one, and nothing else does', () => {
    const now = genesis + 2n * DEPLOYED_PERIOD_SECONDS;

    // Period 5 is three semi-monthly periods away...
    expect(isPayableNow(genesis, 5, SEMI_MONTHLY, now)).toBe(false);
    // ...and already in the past on a daily cadence.
    expect(isPayableNow(genesis, 5, DAILY, now)).toBe(true);
  });

  it('refuses a negative period rather than computing a payday in the past', () => {
    expect(() => payableAt(genesis, -1, SEMI_MONTHLY)).toThrow(/non-negative/);
  });
});

describe('what a cadence change does NOT update on its own', () => {
  it('rescales a contract window, because endPeriod counts periods and not time', () => {
    // A one-year contract is 24 semi-monthly periods and 264 daily ones. Left
    // at 24, a record moved to daily stops paying after about a month — the
    // covenant simply fails `require(period <= endPeriod)` with nothing
    // attached to the failure to say why.
    expect(rescaleEndPeriod(24, SEMI_MONTHLY, DAILY)).toBe(264);
    expect(rescaleEndPeriod(24, SEMI_MONTHLY, WEEKLY)).toBe(48);
    expect(rescaleEndPeriod(264, DAILY, SEMI_MONTHLY)).toBe(24);
  });

  it('rounds a window up, never down — the alternative shortens employment', () => {
    // 1 weekly period is 1/4 of a month, which is 5.5 daily periods. Six.
    expect(rescaleEndPeriod(1, WEEKLY, DAILY)).toBe(6);
    // 1 daily period is less than one weekly period, and must not become zero.
    expect(rescaleEndPeriod(1, DAILY, WEEKLY)).toBe(1);
  });

  it('rescales withholding tax, because taxPerPeriod is dimensionless on chain', () => {
    // ₱2,043.20 a semi-monthly period is ₱4,086.40 a month, which is ₱185.74
    // a working day. Leave it at 2,043.20 and the covenant sends that figure
    // 22 times — 22x the month's tax, out of the employee's pay.
    const semiMonthly = 204_320n;

    expect(rescaleTaxPerPeriod(semiMonthly, SEMI_MONTHLY, DAILY)).toBe(18_574n);
    expect(rescaleTaxPerPeriod(semiMonthly, SEMI_MONTHLY, WEEKLY)).toBe(102_160n);
    expect(rescaleTaxPerPeriod(semiMonthly, SEMI_MONTHLY, SEMI_MONTHLY)).toBe(semiMonthly);
  });

  it('keeps a rescaled tax under the month it came from', () => {
    // Truncating division means the rescaled figure times the new period count
    // must never EXCEED the month — over-remitting is money taken from someone
    // who did not owe it.
    const semiMonthly = 204_320n;
    const monthly = semiMonthly * 2n;

    for (const target of SELECTABLE_SCHEDULES) {
      const perPeriod = rescaleTaxPerPeriod(semiMonthly, SEMI_MONTHLY, target);

      expect(perPeriod * BigInt(target.periodsPerMonth)).toBeLessThanOrEqual(monthly);
    }
  });
});

describe('the month still closes exactly after a cadence change', () => {
  it('remits the published bracket at whichever cadence is now in force', () => {
    // The property the whole project rests on has to survive the new setting:
    // change the cadence, and what reaches each agency across the month is
    // still the figure the agency published, to the centavo.
    const monthly = monthlyObligations(ANALYST.monthlyBasic, ANALYST.monthlyAllowance);

    for (const schedule of SELECTABLE_SCHEDULES) {
      const periods = scheduleMonth({ ...ANALYST, schedule });
      const total = (pick: (p: (typeof periods)[number]) => bigint): bigint =>
        periods.reduce((sum, period) => sum + pick(period), 0n);

      expect(periods).toHaveLength(schedule.periodsPerMonth);
      expect(total((p) => p.sssEE)).toBe(monthly.sssEE);
      expect(total((p) => p.sssER)).toBe(monthly.sssER);
      expect(total((p) => p.sssEC)).toBe(monthly.sssEC);
      expect(total((p) => p.phicEE)).toBe(monthly.phicEE);
      expect(total((p) => p.phicER)).toBe(monthly.phicER);
      expect(total((p) => p.hdmfEE)).toBe(monthly.hdmfEE);
      expect(total((p) => p.hdmfER)).toBe(monthly.hdmfER);
      expect(total((p) => p.tax)).toBe(ANALYST.monthlyTax);
      expect(total((p) => p.gross)).toBe(monthly.monthlyCompensation);
    }
  });

  it('does not let a cadence change alter what the month owes', () => {
    // Cadence is how often, not how much. The monthly obligation is a property
    // of the salary and the published brackets, and must be identical across
    // every schedule — otherwise HR could lower an employee's SSS credit by
    // changing a dropdown.
    const [first, ...rest] = SELECTABLE_SCHEDULES.map((schedule) => {
      const periods = scheduleMonth({ ...ANALYST, schedule });

      return periods.reduce((sum, period) => sum + period.totalDrawn, 0n);
    });

    for (const drawn of rest) expect(drawn).toBe(first);
  });
});
