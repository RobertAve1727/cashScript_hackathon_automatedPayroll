import { describe, expect, it } from 'vitest';
import {
  BasisPoints,
  CashAddress,
  Employee,
  EmployeeId,
  EmploymentStatus,
  IllegalStateTransitionError,
  InvariantViolationError,
  Satoshis,
} from '../../src/domain/index.js';
import { BOB_TESTNET } from '../support/addresses.js';
import { anEmployee } from '../support/builders.js';

describe('Employee', () => {
  describe('enrolment', () => {
    it('starts active and payable', () => {
      const employee = anEmployee();

      expect(employee.status).toBe(EmploymentStatus.Active);
      expect(employee.isPayable()).toBe(true);
    });

    it('trims the name', () => {
      expect(anEmployee({ fullName: '  Alice Rivera  ' }).fullName).toBe('Alice Rivera');
    });

    it.each([['empty', ''], ['whitespace only', '   '], ['too long', 'x'.repeat(121)]])(
      'rejects a %s name',
      (_case, fullName) => {
        expect(() => anEmployee({ fullName })).toThrow(InvariantViolationError);
      },
    );

    it('rejects a zero salary', () => {
      expect(() =>
        Employee.enrol({
          id: EmployeeId.of('emp-1'),
          fullName: 'Alice',
          payoutAddress: CashAddress.parse(BOB_TESTNET),
          salaryPerPeriod: Satoshis.ZERO,
          withholding: BasisPoints.ZERO,
          enrolledAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ).toThrow(/greater than zero/);
    });
  });

  describe('lifecycle', () => {
    it('suspends and reinstates', () => {
      const employee = anEmployee();

      employee.suspend();
      expect(employee.status).toBe(EmploymentStatus.Suspended);
      expect(employee.isPayable()).toBe(false);

      employee.reinstate();
      expect(employee.isPayable()).toBe(true);
    });

    it('refuses to suspend an already suspended employee', () => {
      const employee = anEmployee();
      employee.suspend();

      expect(() => employee.suspend()).toThrow(IllegalStateTransitionError);
    });

    it('offboards from active or suspended', () => {
      const fromActive = anEmployee();
      fromActive.offboard();
      expect(fromActive.status).toBe(EmploymentStatus.Offboarded);

      const fromSuspended = anEmployee();
      fromSuspended.suspend();
      fromSuspended.offboard();
      expect(fromSuspended.status).toBe(EmploymentStatus.Offboarded);
    });

    it('treats offboarding as terminal', () => {
      const employee = anEmployee();
      employee.offboard();

      expect(() => employee.reinstate()).toThrow(IllegalStateTransitionError);
      expect(() => employee.offboard()).toThrow(IllegalStateTransitionError);
      expect(() => employee.changeSalary(Satoshis.fromBch('1'))).toThrow(IllegalStateTransitionError);
      expect(() => employee.changePayoutAddress(CashAddress.parse(BOB_TESTNET))).toThrow(
        IllegalStateTransitionError,
      );
    });
  });

  describe('changes', () => {
    it('updates salary, withholding and payout address', () => {
      const employee = anEmployee();

      employee.changeSalary(Satoshis.fromBch('1.25'));
      employee.changeWithholding(BasisPoints.of(750));
      employee.changePayoutAddress(CashAddress.parse(BOB_TESTNET));

      expect(employee.salaryPerPeriod.toBchString()).toBe('1.25');
      expect(employee.withholding.toPercentageString()).toBe('7.5%');
      expect(employee.payoutAddress.value).toBe(BOB_TESTNET);
    });

    it('still refuses a zero salary on update', () => {
      expect(() => anEmployee().changeSalary(Satoshis.ZERO)).toThrow(/greater than zero/);
    });

    it('allows a suspended employee to be repriced', () => {
      const employee = anEmployee();
      employee.suspend();
      employee.changeSalary(Satoshis.fromBch('2'));

      expect(employee.salaryPerPeriod.toBchString()).toBe('2');
    });
  });

  describe('persistence', () => {
    it('round-trips through a snapshot without losing state', () => {
      const original = anEmployee({ salaryBch: '0.125', withholdingBps: 1_250 });
      original.suspend();

      const restored = Employee.fromSnapshot(original.toSnapshot());

      expect(restored.toSnapshot()).toEqual(original.toSnapshot());
      expect(restored.id.equals(original.id)).toBe(true);
      expect(restored.status).toBe(EmploymentStatus.Suspended);
    });

    it('produces a JSON-safe snapshot', () => {
      const snapshot = anEmployee({ salaryBch: '0.125' }).toSnapshot();

      expect(JSON.parse(JSON.stringify(snapshot))).toEqual(snapshot);
      expect(snapshot.salaryPerPeriod).toBe('12500000');
    });
  });
});
