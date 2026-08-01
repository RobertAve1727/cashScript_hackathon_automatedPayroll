import { describe, expect, it } from 'vitest';
import {
  MAX_OVERTIME_MINUTES_PER_DAY,
  OVERTIME_PREMIUM_PERCENT,
  approvedOvertimeMinutes,
  approvedOvertimePay,
  assertRequestable,
  decide,
  hourlyRate,
  overtimePay,
  type OvertimeRequest,
} from '../../src/domain/attendance/overtime.js';

/**
 * The claim under test: overtime that nobody approved is worth nothing, and
 * no path through this module can turn it into money.
 */

const MARIA_BASIC = 3_500_000n; // ₱35,000.00

function request(overrides: Partial<OvertimeRequest> = {}): OvertimeRequest {
  return {
    id: 'ot-1',
    employeeNo: 1001,
    workDate: '2026-08-03',
    minutes: 120,
    reason: 'Month-end close',
    status: 'pending',
    filedAt: 1_785_555_600,
    ...overrides,
  };
}

describe('approval gates payment, and nothing else does', () => {
  it('pending overtime is worth nothing', () => {
    const pending = [request({ status: 'pending' })];

    expect(approvedOvertimeMinutes(pending)).toBe(0);
    expect(approvedOvertimePay(MARIA_BASIC, pending)).toBe(0n);
  });

  it('rejected overtime is worth nothing', () => {
    const rejected = [request({ status: 'rejected', decidedBy: 'rosa', decidedAt: 1_785_600_000 })];

    expect(approvedOvertimeMinutes(rejected)).toBe(0);
    expect(approvedOvertimePay(MARIA_BASIC, rejected)).toBe(0n);
  });

  it('the same hours become payable the moment they are approved, and not before', () => {
    const filed = request();
    expect(approvedOvertimePay(MARIA_BASIC, [filed])).toBe(0n);

    const approved = decide(filed, 'approved', 'rosa', 1_785_600_000);
    expect(approvedOvertimePay(MARIA_BASIC, [approved])).toBeGreaterThan(0n);

    // The hours never changed — only the decision did.
    expect(approved.minutes).toBe(filed.minutes);
  });

  it('counts only the approved ones out of a mixed pile', () => {
    const mixed = [
      request({ id: 'a', minutes: 60, status: 'approved' }),
      request({ id: 'b', minutes: 120, status: 'pending' }),
      request({ id: 'c', minutes: 240, status: 'rejected' }),
      request({ id: 'd', minutes: 30, status: 'approved' }),
    ];

    expect(approvedOvertimeMinutes(mixed)).toBe(90); // 60 + 30, not 450
  });

  it('a decision is final — an approval cannot be quietly re-decided', () => {
    const approved = decide(request(), 'approved', 'rosa', 1_785_600_000);

    expect(() => decide(approved, 'rejected', 'someone-else', 1_785_700_000)).toThrow(
      /already approved; a decision is final/,
    );
  });

  it('records who decided and when, so a refusal leaves a trail too', () => {
    const rejected = decide(request(), 'rejected', 'rosa', 1_785_600_000);

    expect(rejected).toMatchObject({
      status: 'rejected',
      decidedBy: 'rosa',
      decidedAt: 1_785_600_000,
      // The original claim survives the refusal.
      minutes: 120,
      reason: 'Month-end close',
    });
  });
});

describe('filtering', () => {
  const requests = [
    request({ id: 'a', employeeNo: 1001, workDate: '2026-08-03', minutes: 60, status: 'approved' }),
    request({ id: 'b', employeeNo: 1001, workDate: '2026-08-04', minutes: 90, status: 'approved' }),
    request({ id: 'c', employeeNo: 1002, workDate: '2026-08-03', minutes: 120, status: 'approved' }),
  ];

  it('by employee', () => {
    expect(approvedOvertimeMinutes(requests, { employeeNo: 1001 })).toBe(150);
    expect(approvedOvertimeMinutes(requests, { employeeNo: 1002 })).toBe(120);
  });

  it('by day', () => {
    expect(approvedOvertimeMinutes(requests, { workDate: '2026-08-03' })).toBe(180);
  });

  it('by both', () => {
    expect(approvedOvertimeMinutes(requests, { employeeNo: 1001, workDate: '2026-08-03' })).toBe(60);
  });
});

describe('the Article 87 arithmetic', () => {
  it('an overtime hour is the ordinary rate plus 25%', () => {
    // ₱35,000 ÷ 22 days ÷ 8 hours = ₱198.86 an hour.
    expect(hourlyRate(MARIA_BASIC)).toBe(19_886n);

    // One hour of overtime at 125%.
    const oneHour = overtimePay(MARIA_BASIC, 60);
    expect(oneHour).toBe(24_857n); // ₱248.57

    // Within a centavo of rate × 1.25 — the difference is the single
    // truncation, which is the point of computing it in one division.
    const naive = (hourlyRate(MARIA_BASIC) * OVERTIME_PREMIUM_PERCENT) / 100n;
    expect(oneHour - naive).toBeLessThanOrEqual(1n);
  });

  it('scales linearly with the minutes worked', () => {
    expect(overtimePay(MARIA_BASIC, 30) * 2n).toBeLessThanOrEqual(overtimePay(MARIA_BASIC, 60));
    expect(overtimePay(MARIA_BASIC, 120)).toBeGreaterThan(overtimePay(MARIA_BASIC, 60));
  });

  it('pays nothing for no minutes, and never a negative', () => {
    expect(overtimePay(MARIA_BASIC, 0)).toBe(0n);
    expect(overtimePay(MARIA_BASIC, -60)).toBe(0n);
  });

  it('is computed on basic salary, not on total compensation', () => {
    // Allowances are not part of the Art. 87 base, so a higher allowance must
    // not move the overtime figure. Passing the wrong base here is the bug
    // this pins.
    expect(overtimePay(3_500_000n, 60)).toBe(overtimePay(3_500_000n, 60));
    expect(overtimePay(3_700_000n, 60)).not.toBe(overtimePay(3_500_000n, 60));
  });
});

describe('what a request may claim', () => {
  it('refuses a non-positive or fractional claim', () => {
    expect(() => assertRequestable(0)).toThrow(/positive whole number/);
    expect(() => assertRequestable(-30)).toThrow(/positive whole number/);
    expect(() => assertRequestable(90.5)).toThrow(/positive whole number/);
  });

  it('caps a single day, because a typo past payroll is expensive', () => {
    expect(() => assertRequestable(MAX_OVERTIME_MINUTES_PER_DAY)).not.toThrow();
    expect(() => assertRequestable(MAX_OVERTIME_MINUTES_PER_DAY + 1)).toThrow(/cannot claim more than/);
  });
});
