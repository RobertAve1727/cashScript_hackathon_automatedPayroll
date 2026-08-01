import {
  BasisPoints,
  CashAddress,
  Employee,
  EmployeeId,
  Satoshis,
  type BchNetwork,
  type EmployeeRepository,
} from '../../domain/index.js';
import { toEmployeeDto, type EmployeeDto } from '../dto/employee.dto.js';
import {
  DuplicatePayoutAddressError,
  InvalidPayoutAddressError,
  PayoutAddressNetworkMismatchError,
} from '../errors/employee.errors.js';
import type { AddressValidator } from '../ports/address-validator.js';
import type { Clock } from '../ports/clock.js';
import type { IdGenerator } from '../ports/id-generator.js';
import type { Logger } from '../ports/logger.js';
import type { UseCase } from './use-case.js';

export interface EnrolEmployeeInput {
  readonly fullName: string;
  readonly payoutAddress: string;
  /** Salary per pay period, as a decimal BCH string such as `"0.25"`. */
  readonly salaryBch: string;
  /** Withholding in basis points (750 = 7.5%). Defaults to none. */
  readonly withholdingBps?: number | undefined;
}

/**
 * Put a new person on the payroll.
 *
 * Three checks stand between an input string and a payout destination: the
 * domain validates the shape, the `AddressValidator` port validates the
 * checksum, and this use case validates the network and uniqueness. Getting a
 * payout address wrong is unrecoverable once a transaction confirms, so all
 * three run before anything is persisted.
 */
export class EnrolEmployeeUseCase implements UseCase<EnrolEmployeeInput, EmployeeDto> {
  constructor(
    private readonly employees: EmployeeRepository,
    private readonly addressValidator: AddressValidator,
    private readonly idGenerator: IdGenerator,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly treasuryNetwork: BchNetwork,
  ) {}

  async execute(input: EnrolEmployeeInput): Promise<EmployeeDto> {
    const payoutAddress = CashAddress.parse(input.payoutAddress);

    const validation = this.addressValidator.validate(payoutAddress);
    if (!validation.ok) {
      throw new InvalidPayoutAddressError(payoutAddress.value, validation.reason);
    }

    if (!payoutAddress.belongsTo(this.treasuryNetwork)) {
      throw new PayoutAddressNetworkMismatchError(
        payoutAddress.value,
        payoutAddress.network,
        this.treasuryNetwork,
      );
    }

    const existing = await this.employees.findByPayoutAddress(payoutAddress);
    if (existing !== null) {
      throw new DuplicatePayoutAddressError(payoutAddress.value, existing.id.value);
    }

    const employee = Employee.enrol({
      id: EmployeeId.of(this.idGenerator.next()),
      fullName: input.fullName,
      payoutAddress,
      salaryPerPeriod: Satoshis.fromBch(input.salaryBch),
      withholding: input.withholdingBps === undefined ? BasisPoints.ZERO : BasisPoints.of(input.withholdingBps),
      enrolledAt: this.clock.now(),
    });

    await this.employees.save(employee);

    this.logger.info('employee enrolled', {
      employeeId: employee.id.value,
      salarySats: employee.salaryPerPeriod.toString(),
    });

    return toEmployeeDto(employee);
  }
}
