import { IllegalStateTransitionError } from '../errors/illegal-state-transition.error.js';
import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { BasisPoints } from '../value-objects/basis-points.js';
import { CashAddress } from '../value-objects/cash-address.js';
import { EmployeeId } from '../value-objects/employee-id.js';
import { Satoshis } from '../value-objects/satoshis.js';

export const EmploymentStatus = {
  Active: 'active',
  Suspended: 'suspended',
  Offboarded: 'offboarded',
} as const;

export type EmploymentStatus = (typeof EmploymentStatus)[keyof typeof EmploymentStatus];

export interface EmployeeSnapshot {
  readonly id: string;
  readonly fullName: string;
  readonly payoutAddress: string;
  readonly salaryPerPeriod: string;
  readonly withholdingBps: number;
  readonly status: EmploymentStatus;
  readonly enrolledAt: string;
}

export interface EnrolEmployeeProps {
  readonly id: EmployeeId;
  readonly fullName: string;
  readonly payoutAddress: CashAddress;
  readonly salaryPerPeriod: Satoshis;
  readonly withholding: BasisPoints;
  readonly enrolledAt: Date;
}

const MAX_NAME_LENGTH = 120;

/**
 * A person on the payroll.
 *
 * The aggregate root for everything about who gets paid and how much. It owns
 * its own lifecycle: only an active employee is payable, an offboarded employee
 * can never be edited or reinstated, and salary/address changes are refused
 * rather than silently ignored when the employee is no longer employed.
 */
export class Employee {
  private constructor(
    readonly id: EmployeeId,
    private currentName: string,
    private currentPayoutAddress: CashAddress,
    private currentSalary: Satoshis,
    private currentWithholding: BasisPoints,
    private currentStatus: EmploymentStatus,
    private readonly enrolledAtMs: number,
  ) {}

  static enrol(props: EnrolEmployeeProps): Employee {
    const fullName = props.fullName.trim();

    if (fullName.length === 0) {
      throw new InvariantViolationError('Employee', 'full name must not be empty');
    }
    if (fullName.length > MAX_NAME_LENGTH) {
      throw new InvariantViolationError('Employee', `full name must be at most ${MAX_NAME_LENGTH} characters`);
    }
    if (props.salaryPerPeriod.isZero()) {
      throw new InvariantViolationError('Employee', `salary for ${fullName} must be greater than zero`);
    }
    if (Number.isNaN(props.enrolledAt.getTime())) {
      throw new InvariantViolationError('Employee', 'enrolledAt must be a valid date');
    }

    return new Employee(
      props.id,
      fullName,
      props.payoutAddress,
      props.salaryPerPeriod,
      props.withholding,
      EmploymentStatus.Active,
      props.enrolledAt.getTime(),
    );
  }

  static fromSnapshot(snapshot: EmployeeSnapshot): Employee {
    return new Employee(
      EmployeeId.of(snapshot.id),
      snapshot.fullName,
      CashAddress.parse(snapshot.payoutAddress),
      Satoshis.from(BigInt(snapshot.salaryPerPeriod)),
      BasisPoints.of(snapshot.withholdingBps),
      snapshot.status,
      new Date(snapshot.enrolledAt).getTime(),
    );
  }

  get fullName(): string {
    return this.currentName;
  }

  get payoutAddress(): CashAddress {
    return this.currentPayoutAddress;
  }

  get salaryPerPeriod(): Satoshis {
    return this.currentSalary;
  }

  get withholding(): BasisPoints {
    return this.currentWithholding;
  }

  get status(): EmploymentStatus {
    return this.currentStatus;
  }

  get enrolledAt(): Date {
    return new Date(this.enrolledAtMs);
  }

  /** Only active employees are included in a payroll run. */
  isPayable(): boolean {
    return this.currentStatus === EmploymentStatus.Active;
  }

  changeSalary(salary: Satoshis): void {
    this.assertEditable('change salary');

    if (salary.isZero()) {
      throw new InvariantViolationError('Employee', `salary for ${this.currentName} must be greater than zero`);
    }

    this.currentSalary = salary;
  }

  changeWithholding(withholding: BasisPoints): void {
    this.assertEditable('change withholding');
    this.currentWithholding = withholding;
  }

  changePayoutAddress(address: CashAddress): void {
    this.assertEditable('change payout address');
    this.currentPayoutAddress = address;
  }

  /** Temporarily stop paying an employee — unpaid leave, a hold, an audit. */
  suspend(): void {
    this.transitionTo(EmploymentStatus.Suspended, [EmploymentStatus.Active]);
  }

  reinstate(): void {
    this.transitionTo(EmploymentStatus.Active, [EmploymentStatus.Suspended]);
  }

  /** Terminal: an offboarded employee can never be edited or reinstated. */
  offboard(): void {
    this.transitionTo(EmploymentStatus.Offboarded, [EmploymentStatus.Active, EmploymentStatus.Suspended]);
  }

  toSnapshot(): EmployeeSnapshot {
    return {
      id: this.id.value,
      fullName: this.currentName,
      payoutAddress: this.currentPayoutAddress.value,
      salaryPerPeriod: this.currentSalary.toJSON(),
      withholdingBps: this.currentWithholding.toJSON(),
      status: this.currentStatus,
      enrolledAt: this.enrolledAt.toISOString(),
    };
  }

  private assertEditable(intent: string): void {
    if (this.currentStatus === EmploymentStatus.Offboarded) {
      throw new IllegalStateTransitionError('Employee', this.currentStatus, intent);
    }
  }

  private transitionTo(target: EmploymentStatus, allowedFrom: readonly EmploymentStatus[]): void {
    if (!allowedFrom.includes(this.currentStatus)) {
      throw new IllegalStateTransitionError('Employee', this.currentStatus, target);
    }
    this.currentStatus = target;
  }
}
