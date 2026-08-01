import {
  EmploymentAction,
  type ChangeEmploymentStatusUseCase,
  type EnrolEmployeeUseCase,
  type ListEmployeesUseCase,
  type UpdateEmployeePayUseCase,
} from '../../../application/index.js';
import type { Command, CommandContext } from '../command.js';
import { presentEmployee, presentEmployees } from '../presenters/employee.presenter.js';
import { UsageError } from '../usage.error.js';

export class EnrolEmployeeCommand implements Command {
  readonly name = 'employee:add';
  readonly summary = 'enrol a new employee on the payroll';
  readonly usage = 'employee:add --name <name> --address <cashaddr> --salary <bch> [--withholding-bps <n>] [--json]';

  constructor(private readonly useCase: EnrolEmployeeUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const employee = await this.useCase.execute({
      fullName: args.requireString('name'),
      payoutAddress: args.requireString('address'),
      salaryBch: args.requireString('salary'),
      withholdingBps: args.number('withholding-bps'),
    });

    out.write(presentEmployee(employee, args.flag('json')));
  }
}

export class ListEmployeesCommand implements Command {
  readonly name = 'employee:list';
  readonly summary = 'list the roster';
  readonly usage = 'employee:list [--payable] [--json]';

  constructor(private readonly useCase: ListEmployeesUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const employees = await this.useCase.execute({ payableOnly: args.flag('payable') });

    out.write(presentEmployees(employees, args.flag('json')));
  }
}

export class UpdateEmployeePayCommand implements Command {
  readonly name = 'employee:pay';
  readonly summary = 'change an employee salary or withholding rate';
  readonly usage = 'employee:pay --id <id> [--salary <bch>] [--withholding-bps <n>] [--json]';

  constructor(private readonly useCase: UpdateEmployeePayUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const salaryBch = args.string('salary');
    const withholdingBps = args.number('withholding-bps');

    if (salaryBch === undefined && withholdingBps === undefined) {
      throw new UsageError('nothing to change: pass --salary, --withholding-bps, or both', this.usage);
    }

    const employee = await this.useCase.execute({
      employeeId: args.requireString('id'),
      salaryBch,
      withholdingBps,
    });

    out.write(presentEmployee(employee, args.flag('json')));
  }
}

const ACTIONS: Readonly<Record<string, EmploymentAction>> = {
  suspend: EmploymentAction.Suspend,
  reinstate: EmploymentAction.Reinstate,
  offboard: EmploymentAction.Offboard,
};

export class ChangeEmploymentStatusCommand implements Command {
  readonly name = 'employee:status';
  readonly summary = 'suspend, reinstate or offboard an employee';
  readonly usage = 'employee:status --id <id> --action <suspend|reinstate|offboard> [--json]';

  constructor(private readonly useCase: ChangeEmploymentStatusUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const requested = args.requireString('action').toLowerCase();
    const action = ACTIONS[requested];

    if (action === undefined) {
      throw new UsageError(`unknown action "${requested}" — expected ${Object.keys(ACTIONS).join(', ')}`, this.usage);
    }

    const employee = await this.useCase.execute({ employeeId: args.requireString('id'), action });

    out.write(presentEmployee(employee, args.flag('json')));
  }
}
