import { describe, expect, it } from 'vitest';
import { FIXTURE_ANALYST, FIXTURE_ENTRY_LEVEL, computeDeductions } from '../../../src/domain/index.js';
import { buildTx, fundScenario, PERIOD_SECONDS } from '../../support/esahod.js';

/**
 * The claim under test: the covenant settles ANY cadence, not just the
 * semi-monthly one it was born with.
 *
 * `periodsPerMonth` is a constructor argument, so it is part of the treasury's
 * address — a company paying weekly deploys a weekly treasury. What this proves
 * is that such a treasury ACCEPTS a weekly payroll on the real Bitcoin Cash VM,
 * which is what lets the pay-schedule screen call a cadence settled instead of
 * "engine-ready".
 *
 * These run through libauth's VM via MockNetworkProvider. A transaction that
 * the covenant would reject fails here with the covenant's own message.
 */

/** A weekly treasury: 4 periods a month, so periodSeconds is a quarter-month. */
const WEEKLY_PERIODS = 4n;
const WEEKLY_SECONDS = 31_556_952n / 48n;

/** A daily treasury: 22 working days a month. */
const DAILY_PERIODS = 22n;
const DAILY_SECONDS = 31_556_952n / 264n;

describe('a weekly treasury', () => {
  it('accepts a weekly payroll on the real VM', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST, {
      periodsPerMonth: WEEKLY_PERIODS,
      periodSeconds: WEEKLY_SECONDS,
    });

    await expect(buildTx(scenario, WEEKLY_SECONDS, WEEKLY_PERIODS).send()).resolves.toBeDefined();
  });

  it('pays a quarter of the month, not a half', async () => {
    const weekly = fundScenario(FIXTURE_ANALYST, {
      periodsPerMonth: WEEKLY_PERIODS,
      periodSeconds: WEEKLY_SECONDS,
    });
    const semiMonthly = fundScenario(FIXTURE_ANALYST);

    const weeklyTx = await buildTx(weekly, WEEKLY_SECONDS, WEEKLY_PERIODS).send();
    const semiTx = await buildTx(semiMonthly).send();

    // Output 0 is net pay. A weekly period is half a semi-monthly one, so the
    // employee receives roughly half as much — and crucially NOT the same
    // amount, which is what a treasury deployed with a shorter periodSeconds
    // and an unchanged divisor would have paid.
    const weeklyNet = weeklyTx.outputs[0]!.token!.amount;
    const semiNet = semiTx.outputs[0]!.token!.amount;

    expect(weeklyNet).toBeLessThan(semiNet);
    expect(weeklyNet * 2n).toBeLessThanOrEqual(semiNet + 200n);
  });
});

describe('a daily treasury', () => {
  it('accepts a daily payroll on the real VM', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST, {
      periodsPerMonth: DAILY_PERIODS,
      periodSeconds: DAILY_SECONDS,
    });

    await expect(buildTx(scenario, DAILY_SECONDS, DAILY_PERIODS).send()).resolves.toBeDefined();
  });

  it('pays about a twenty-second of the month', async () => {
    // FIXTURE_ENTRY_LEVEL, because its withholding tax is zero. The analyst's
    // taxPerPeriod is a FIXED figure in the 40-byte commitment denominated in
    // the covenant's period — it does not rescale when the cadence does, so at
    // daily cadence the covenant would subtract a semi-monthly tax from a
    // daily gross twenty-two times a month. That is a real trap, documented on
    // `rescaleTaxPerPeriod` and surfaced by the pay-schedule screen; it is not
    // what this test is measuring.
    const daily = fundScenario(FIXTURE_ENTRY_LEVEL, {
      periodsPerMonth: DAILY_PERIODS,
      periodSeconds: DAILY_SECONDS,
    });
    const semiMonthly = fundScenario(FIXTURE_ENTRY_LEVEL);

    const dailyNet = (await buildTx(daily, DAILY_SECONDS, DAILY_PERIODS).send()).outputs[0]!.token!.amount;
    const semiNet = (await buildTx(semiMonthly).send()).outputs[0]!.token!.amount;

    // 11 daily periods to one semi-monthly one, give or take truncation.
    expect(dailyNet * 11n).toBeLessThanOrEqual(semiNet + 2_000n);
    expect(dailyNet * 11n).toBeGreaterThan(semiNet - 20_000n);
  });
});

describe('semi-monthly is untouched by the parametrisation', () => {
  it('still pays exactly what the off-chain mirror computes', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST);
    const receipt = await buildTx(scenario).send();

    const expected = computeDeductions({
      monthlyBasic: FIXTURE_ANALYST.monthlyBasic,
      monthlyAllowance: FIXTURE_ANALYST.monthlyAllowance,
      taxPerPeriod: FIXTURE_ANALYST.taxPerPeriod,
    });

    expect(receipt.outputs[0]!.token!.amount).toBe(expected.net);
    expect(PERIOD_SECONDS).toBe(1_314_873n);
  });
});
