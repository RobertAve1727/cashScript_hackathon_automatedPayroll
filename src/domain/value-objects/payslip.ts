import { DUST_LIMIT_SATOSHIS } from '../constants.js';
import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { BasisPoints } from './basis-points.js';
import { CashAddress } from './cash-address.js';
import { EmployeeId } from './employee-id.js';
import { Satoshis } from './satoshis.js';

export interface PayslipSnapshot {
  readonly employeeId: string;
  readonly payoutAddress: string;
  readonly gross: string;
  readonly withheld: string;
  readonly net: string;
}

export interface IssuePayslipProps {
  readonly employeeId: EmployeeId;
  readonly payoutAddress: CashAddress;
  readonly gross: Satoshis;
  readonly withholding: BasisPoints;
}

const MINIMUM_NET_PAY = Satoshis.from(DUST_LIMIT_SATOSHIS);

/**
 * One employee's line on a payroll run: what they earned, what was withheld,
 * and what will actually be sent on chain.
 *
 * A payslip is immutable and self-consistent — `net` is always
 * `gross - withheld`, and a net below the dust limit is rejected at
 * construction. Catching that here rather than at broadcast time means a run is
 * never approved with a line that the network would refuse to relay.
 */
export class Payslip {
  private constructor(
    readonly employeeId: EmployeeId,
    readonly payoutAddress: CashAddress,
    readonly gross: Satoshis,
    readonly withheld: Satoshis,
    readonly net: Satoshis,
  ) {}

  static issue(props: IssuePayslipProps): Payslip {
    const { employeeId, payoutAddress, gross, withholding } = props;

    const withheld = withholding.applyTo(gross);
    const net = gross.minus(withheld);

    if (net.isLessThan(MINIMUM_NET_PAY)) {
      throw new InvariantViolationError(
        'Payslip',
        `net pay for ${employeeId.value} is ${net.value} sats, below the ${MINIMUM_NET_PAY.value} sat dust limit`,
      );
    }

    return new Payslip(employeeId, payoutAddress, gross, withheld, net);
  }

  static fromSnapshot(snapshot: PayslipSnapshot): Payslip {
    return new Payslip(
      EmployeeId.of(snapshot.employeeId),
      CashAddress.parse(snapshot.payoutAddress),
      Satoshis.from(BigInt(snapshot.gross)),
      Satoshis.from(BigInt(snapshot.withheld)),
      Satoshis.from(BigInt(snapshot.net)),
    );
  }

  toSnapshot(): PayslipSnapshot {
    return {
      employeeId: this.employeeId.value,
      payoutAddress: this.payoutAddress.value,
      gross: this.gross.toJSON(),
      withheld: this.withheld.toJSON(),
      net: this.net.toJSON(),
    };
  }
}
