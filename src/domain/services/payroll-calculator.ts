import type { Employee } from '../entities/employee.js';
import { Payslip } from '../value-objects/payslip.js';
import { Satoshis } from '../value-objects/satoshis.js';

/**
 * Turns a roster into payslips.
 *
 * A domain service rather than a method on `Employee` because the calculation
 * spans the whole roster: it decides who is in the run at all. Deliberately
 * pure and synchronous — no repository, no clock, no I/O — so payroll maths can
 * be tested exhaustively without a single test double.
 */
export class PayrollCalculator {
  /**
   * @param roster Every employee considered for this run; non-payable ones
   *   (suspended, offboarded) are skipped rather than rejected.
   * @returns One payslip per payable employee, in roster order.
   */
  calculate(roster: readonly Employee[]): Payslip[] {
    return roster
      .filter((employee) => employee.isPayable())
      .map((employee) =>
        Payslip.issue({
          employeeId: employee.id,
          payoutAddress: employee.payoutAddress,
          gross: employee.salaryPerPeriod,
          withholding: employee.withholding,
        }),
      );
  }

  /** What the treasury must hold to cover these payslips, fees excluded. */
  totalNet(payslips: readonly Payslip[]): Satoshis {
    return Satoshis.sum(payslips.map((payslip) => payslip.net));
  }
}
