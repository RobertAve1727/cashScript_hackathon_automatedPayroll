import { describe, expect, it } from 'vitest';
import { BasisPoints, CashAddress, PayrollCalculator, Payslip, Satoshis } from '../../src/domain/index.js';
import { BOB_TESTNET, CAROL_TESTNET } from '../support/addresses.js';
import { anEmployee } from '../support/builders.js';

const calculator = new PayrollCalculator();

describe('PayrollCalculator', () => {
  it('issues one payslip per payable employee, in roster order', () => {
    const roster = [
      anEmployee({ id: 'emp-1' }),
      anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET }),
      anEmployee({ id: 'emp-3', payoutAddress: CAROL_TESTNET }),
    ];

    expect(calculator.calculate(roster).map((payslip) => payslip.employeeId.value)).toEqual([
      'emp-1',
      'emp-2',
      'emp-3',
    ]);
  });

  it('skips suspended and offboarded employees rather than failing', () => {
    const suspended = anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET });
    suspended.suspend();
    const offboarded = anEmployee({ id: 'emp-3', payoutAddress: CAROL_TESTNET });
    offboarded.offboard();

    const payslips = calculator.calculate([anEmployee({ id: 'emp-1' }), suspended, offboarded]);

    expect(payslips).toHaveLength(1);
    expect(payslips[0]?.employeeId.value).toBe('emp-1');
  });

  it('returns nothing for an empty or entirely unpayable roster', () => {
    const suspended = anEmployee();
    suspended.suspend();

    expect(calculator.calculate([])).toEqual([]);
    expect(calculator.calculate([suspended])).toEqual([]);
  });

  it('withholds the configured rate, rounding down in the employee favour', () => {
    // 7.5% of 12_345_678 sats is 925_925.85 — the fraction stays with the employee.
    const employee = anEmployee({ salaryBch: '0.12345678', withholdingBps: 750 });
    const payslip = calculator.calculate([employee])[0];

    expect(payslip?.gross.value).toBe(12_345_678n);
    expect(payslip?.withheld.value).toBe(925_925n);
    expect(payslip?.net.value).toBe(11_419_753n);
  });

  it('keeps net equal to gross minus withheld for every payslip', () => {
    const payslips = calculator.calculate([
      anEmployee({ id: 'emp-1', salaryBch: '1', withholdingBps: 3_333 }),
      anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET, salaryBch: '0.007', withholdingBps: 9_000 }),
    ]);

    for (const payslip of payslips) {
      expect(payslip.net.value).toBe(payslip.gross.value - payslip.withheld.value);
    }
  });

  it('totals the net pay a run must cover', () => {
    const payslips = calculator.calculate([
      anEmployee({ id: 'emp-1', salaryBch: '1' }),
      anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET, salaryBch: '0.5' }),
    ]);

    expect(calculator.totalNet(payslips).toBchString()).toBe('1.5');
  });

  it('refuses a payslip whose net pay is dust the network would not relay', () => {
    // 500 sats net is below the 546 sat dust limit.
    expect(() =>
      Payslip.issue({
        employeeId: anEmployee().id,
        payoutAddress: CashAddress.parse(BOB_TESTNET),
        gross: Satoshis.from(500n),
        withholding: BasisPoints.ZERO,
      }),
    ).toThrow(/dust limit/);
  });

  it('refuses a payslip made dust by withholding', () => {
    expect(() =>
      Payslip.issue({
        employeeId: anEmployee().id,
        payoutAddress: CashAddress.parse(BOB_TESTNET),
        gross: Satoshis.from(1_000n),
        withholding: BasisPoints.of(9_000),
      }),
    ).toThrow(/dust limit/);
  });
});
