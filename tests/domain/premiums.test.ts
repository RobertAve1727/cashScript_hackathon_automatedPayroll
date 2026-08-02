import { describe, expect, it } from 'vitest';
import {
  DAY_CLASSIFICATIONS,
  NIGHT_ENDS_HOUR,
  NIGHT_STARTS_HOUR,
  hourFactorBasisPoints,
  isNightHour,
  nightMinutesIn,
  premiumPay,
  segmentsPay,
  unworkedDayPay,
  type DayClassification,
  type HourKind,
} from '../../src/domain/attendance/premiums.js';
import { overtimePay } from '../../src/domain/attendance/overtime.js';

/**
 * The claim under test: every premium in the Labor Code is a multiplier, they
 * compound rather than add, and the compound cases land on the exact figures
 * DOLE publishes.
 *
 * The failure mode that matters here is UNDERPAYMENT. Every assertion is
 * written so that the plausible-but-wrong implementation — additive premiums,
 * night differential applied to the base rate, a special working day treated as
 * a special non-working one — fails it.
 */

/** ₱35,000/month → ₱1,590.90/day → ₱198.86/hour at 22 days, 8 hours. */
const MONTHLY = 3_500_000n;

const hour = (day: DayClassification, overtime = false, night = false): HourKind => ({
  day,
  overtime,
  night,
});

/** Basis points as a readable percentage, for failure messages worth reading. */
const pct = (bp: bigint): number => Number(bp) / 100;

describe('the first eight hours', () => {
  it('pays the statutory rate for every kind of day', () => {
    expect(pct(hourFactorBasisPoints(hour('ordinary')))).toBe(100);
    expect(pct(hourFactorBasisPoints(hour('rest_day')))).toBe(130);
    expect(pct(hourFactorBasisPoints(hour('special_non_working')))).toBe(130);
    expect(pct(hourFactorBasisPoints(hour('special_non_working_rest_day')))).toBe(150);
    expect(pct(hourFactorBasisPoints(hour('regular_holiday')))).toBe(200);
    expect(pct(hourFactorBasisPoints(hour('regular_holiday_rest_day')))).toBe(260);
  });

  it('pays a SPECIAL WORKING day at the ordinary rate, premium-free', () => {
    // The trap this exists to name: a proclamation category that reads like a
    // holiday and carries no premium at all. Treating it as a special
    // non-working day overpays by 30% — the one error here that costs the
    // employer rather than the worker, and still an error.
    expect(hourFactorBasisPoints(hour('special_working'))).toBe(
      hourFactorBasisPoints(hour('ordinary')),
    );
  });
});

describe('overtime compounds on the day’s own rate, not on the ordinary one', () => {
  it('is +25% on an ordinary day and +30% on every other', () => {
    expect(pct(hourFactorBasisPoints(hour('ordinary', true)))).toBe(125);
    expect(pct(hourFactorBasisPoints(hour('special_working', true)))).toBe(125);

    // 130% x 130% = 169%, NOT 130 + 30 = 160%.
    expect(pct(hourFactorBasisPoints(hour('rest_day', true)))).toBe(169);
    expect(pct(hourFactorBasisPoints(hour('special_non_working', true)))).toBe(169);
    // 150% x 130% = 195%
    expect(pct(hourFactorBasisPoints(hour('special_non_working_rest_day', true)))).toBe(195);
    // 200% x 130% = 260%, NOT 200 + 30 = 230%.
    expect(pct(hourFactorBasisPoints(hour('regular_holiday', true)))).toBe(260);
    // 260% x 130% = 338%
    expect(pct(hourFactorBasisPoints(hour('regular_holiday_rest_day', true)))).toBe(338);
  });

  it('never produces the additive answer, on any day', () => {
    // A single guard against the whole class of error: additive premiums are
    // always smaller than multiplicative ones once two premiums stack.
    for (const day of DAY_CLASSIFICATIONS) {
      if (day === 'ordinary' || day === 'special_working') continue;

      const base = hourFactorBasisPoints(hour(day));
      const overtime = hourFactorBasisPoints(hour(day, true));

      expect(overtime).toBeGreaterThan(base + 3_000n);
    }
  });
});

describe('night differential rides on whatever the hour is already worth', () => {
  it('adds 10% of the applicable rate, not 10% of the ordinary rate', () => {
    expect(pct(hourFactorBasisPoints(hour('ordinary', false, true)))).toBe(110);
    expect(pct(hourFactorBasisPoints(hour('rest_day', false, true)))).toBe(143); // 130 x 1.1
    expect(pct(hourFactorBasisPoints(hour('regular_holiday', false, true)))).toBe(220); // 200 x 1.1
  });

  it('lands on the published figures for the fully compound cases', () => {
    // Overtime AND night AND holiday — the hour a worker is owed most for, and
    // the one a naive engine gets most wrong.
    expect(pct(hourFactorBasisPoints(hour('ordinary', true, true)))).toBe(137.5); // 125 x 1.1
    expect(pct(hourFactorBasisPoints(hour('rest_day', true, true)))).toBe(185.9); // 169 x 1.1
    expect(pct(hourFactorBasisPoints(hour('regular_holiday', true, true)))).toBe(286); // 260 x 1.1
    expect(pct(hourFactorBasisPoints(hour('regular_holiday_rest_day', true, true)))).toBe(371.8);
  });

  it('is worth strictly more than the same hour by day, always', () => {
    for (const day of DAY_CLASSIFICATIONS) {
      for (const overtime of [false, true]) {
        expect(hourFactorBasisPoints(hour(day, overtime, true))).toBeGreaterThan(
          hourFactorBasisPoints(hour(day, overtime, false)),
        );
      }
    }
  });
});

describe('the night window wraps midnight', () => {
  it('covers 22:00 to 05:59 and nothing else', () => {
    expect(isNightHour(NIGHT_STARTS_HOUR)).toBe(true);
    expect(isNightHour(23)).toBe(true);
    expect(isNightHour(0)).toBe(true);
    expect(isNightHour(NIGHT_ENDS_HOUR - 1)).toBe(true);

    expect(isNightHour(NIGHT_ENDS_HOUR)).toBe(false);
    expect(isNightHour(12)).toBe(false);
    expect(isNightHour(NIGHT_STARTS_HOUR - 1)).toBe(false);
  });

  it('classifies exactly eight hours as night', () => {
    // `hour >= 22 && hour < 6` is satisfied by no number at all, and pays no
    // differential to anyone. Counting the window catches that instantly.
    const night = Array.from({ length: 24 }, (_, h) => h).filter(isNightHour);

    expect(night).toHaveLength(8);
  });

  it('refuses an hour that is not an hour', () => {
    expect(() => isNightHour(24)).toThrow(/0\.\.23/);
    expect(() => isNightHour(-1)).toThrow(/0\.\.23/);
  });
});

describe('pay in centavos', () => {
  it('matches the existing ordinary-day overtime engine exactly', () => {
    // premiums.ts must not quietly disagree with overtime.ts about the case
    // they both cover, or a payslip's total depends on which one produced it.
    for (const minutes of [1, 30, 60, 90, 137, 480]) {
      expect(premiumPay(MONTHLY, minutes, hour('ordinary', true))).toBe(
        overtimePay(MONTHLY, minutes),
      );
    }
  });

  it('pays a regular holiday hour at twice an ordinary one', () => {
    const ordinary = premiumPay(MONTHLY, 60, hour('ordinary'));
    const holiday = premiumPay(MONTHLY, 60, hour('regular_holiday'));

    expect(holiday).toBe(ordinary * 2n);
  });

  it('truncates once, so half an hour twice is never more than a whole hour', () => {
    for (const day of DAY_CLASSIFICATIONS) {
      const halves = premiumPay(MONTHLY, 30, hour(day)) * 2n;
      const whole = premiumPay(MONTHLY, 60, hour(day));

      expect(halves).toBeLessThanOrEqual(whole);
    }
  });

  it('is zero for zero or negative minutes, and refuses a fraction', () => {
    expect(premiumPay(MONTHLY, 0, hour('regular_holiday'))).toBe(0n);
    expect(premiumPay(MONTHLY, -60, hour('regular_holiday'))).toBe(0n);
    expect(() => premiumPay(MONTHLY, 1.5, hour('ordinary'))).toThrow(/integer/);
  });

  it('sums a shift split across the night boundary', () => {
    // 20:00–02:00: two ordinary evening hours, then four night hours.
    const shift = [
      { day: 'ordinary' as const, overtime: false, night: false, minutes: 120 },
      { day: 'ordinary' as const, overtime: false, night: true, minutes: 240 },
    ];

    const expected =
      premiumPay(MONTHLY, 120, hour('ordinary')) +
      premiumPay(MONTHLY, 240, hour('ordinary', false, true));

    expect(segmentsPay(MONTHLY, shift)).toBe(expected);
    // And the night half is worth more than the same minutes by day.
    expect(premiumPay(MONTHLY, 240, hour('ordinary', false, true))).toBeGreaterThan(
      premiumPay(MONTHLY, 240, hour('ordinary')),
    );
  });
});

describe('a holiday nobody worked', () => {
  it('pays a full day for a regular holiday — the entitlement no punch triggers', () => {
    const daily = MONTHLY / 22n;

    expect(unworkedDayPay(MONTHLY, 'regular_holiday')).toBe(daily);
    expect(unworkedDayPay(MONTHLY, 'regular_holiday_rest_day')).toBe(daily);
  });

  it('pays nothing for an unworked special day — no work, no pay', () => {
    expect(unworkedDayPay(MONTHLY, 'special_non_working')).toBe(0n);
    expect(unworkedDayPay(MONTHLY, 'special_non_working_rest_day')).toBe(0n);
    expect(unworkedDayPay(MONTHLY, 'rest_day')).toBe(0n);
    expect(unworkedDayPay(MONTHLY, 'ordinary')).toBe(0n);
    expect(unworkedDayPay(MONTHLY, 'special_working')).toBe(0n);
  });
});

describe('the table is complete', () => {
  it('prices every classification, so none falls through to zero', () => {
    for (const day of DAY_CLASSIFICATIONS) {
      for (const overtime of [false, true]) {
        for (const night of [false, true]) {
          expect(hourFactorBasisPoints(hour(day, overtime, night))).toBeGreaterThanOrEqual(10_000n);
        }
      }
    }
  });

  it('refuses a classification it does not know', () => {
    expect(() => hourFactorBasisPoints(hour('sale_day' as DayClassification))).toThrow(
      /unknown day classification/,
    );
  });
});

describe('night minutes derived from the punch log', () => {
  /** Unix seconds for a Manila wall-clock time on 2 Aug 2026. */
  const manila = (hour: number, minute = 0): number =>
    Math.floor(Date.UTC(2026, 7, 2, hour - 8, minute) / 1000);

  it('finds no night minutes in an ordinary day shift', () => {
    expect(nightMinutesIn(manila(9), manila(18))).toBe(0);
  });

  it('counts only the part of an evening shift past 22:00', () => {
    // 20:00–23:00 → two ordinary hours, one night hour.
    expect(nightMinutesIn(manila(20), manila(23))).toBe(60);
  });

  it('counts a shift that crosses midnight, both ends', () => {
    // 21:00–07:00 → 22:00-06:00 is night, so eight hours of it.
    expect(nightMinutesIn(manila(21), manila(31))).toBe(8 * 60); // 31 = 07:00 next day
  });

  it('is exact at the boundaries rather than off by an hour', () => {
    expect(nightMinutesIn(manila(21, 59), manila(22, 1))).toBe(1);
    expect(nightMinutesIn(manila(5, 59), manila(6, 1))).toBe(1);
    expect(nightMinutesIn(manila(6), manila(7))).toBe(0);
    expect(nightMinutesIn(manila(22), manila(23))).toBe(60);
  });

  it('pays nothing for an open or inverted day', () => {
    expect(nightMinutesIn(manila(22), manila(22))).toBe(0);
    expect(nightMinutesIn(manila(23), manila(22))).toBe(0);
  });

  it('answers in Manila time regardless of where the machine is', () => {
    // The same instant is night in Manila and afternoon in UTC. An engine that
    // read the host clock would pay a differential to the wrong hours.
    const startUtcNoon = Math.floor(Date.UTC(2026, 7, 2, 14, 0) / 1000); // 22:00 Manila
    expect(nightMinutesIn(startUtcNoon, startUtcNoon + 3_600)).toBe(60);
    expect(nightMinutesIn(startUtcNoon, startUtcNoon + 3_600, 0)).toBe(0); // UTC frame: 14:00
  });
});

describe('double holidays', () => {
  it('pays 300%, not 200% — a full day short is the cost of missing this', () => {
    expect(pct(hourFactorBasisPoints(hour('double_holiday')))).toBe(300);
    expect(pct(hourFactorBasisPoints(hour('double_holiday_rest_day')))).toBe(390);
  });

  it('compounds overtime and night on top, like every other day', () => {
    expect(pct(hourFactorBasisPoints(hour('double_holiday', true)))).toBe(390); // 300 x 1.3
    expect(pct(hourFactorBasisPoints(hour('double_holiday', true, true)))).toBe(429); // x 1.1
    expect(pct(hourFactorBasisPoints(hour('double_holiday_rest_day', true, true)))).toBe(557.7);
  });

  it('pays two days for a double holiday nobody worked', () => {
    expect(unworkedDayPay(MONTHLY, 'double_holiday')).toBe((MONTHLY * 2n) / 22n);
    expect(unworkedDayPay(MONTHLY, 'double_holiday_rest_day')).toBe((MONTHLY * 2n) / 22n);
  });
});

describe('the two cells that do not compose', () => {
  it('pays 195% for two special non-working days on a rest day', () => {
    // Not 150 x 1.30 and not 130 x 1.30 — DOLE prints this cell, which is why
    // the day factors are a lookup rather than a product of flags.
    expect(pct(hourFactorBasisPoints(hour('double_special_non_working_rest_day')))).toBe(195);
    expect(pct(hourFactorBasisPoints(hour('double_special_non_working_rest_day', true)))).toBe(253.5);
  });

  it('pays the rest-day rate when a special WORKING day lands on a rest day', () => {
    // The literal reading — "a special working day is an ordinary day" — pays
    // 100% and drops the 30% Art. 93(a) attaches to the rest day itself.
    expect(pct(hourFactorBasisPoints(hour('special_working_rest_day')))).toBe(130);
    expect(hourFactorBasisPoints(hour('special_working_rest_day'))).toBeGreaterThan(
      hourFactorBasisPoints(hour('special_working')),
    );
  });

  it('still pays nothing extra for an unworked special or working day', () => {
    expect(unworkedDayPay(MONTHLY, 'double_special_non_working_rest_day')).toBe(0n);
    expect(unworkedDayPay(MONTHLY, 'special_working_rest_day')).toBe(0n);
  });
});
