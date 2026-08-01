import type {
  ApprovePayrollRunUseCase,
  GetPayrollRunUseCase,
  InspectTreasuryUseCase,
  ListPayrollRunsUseCase,
  OpenPayrollRunUseCase,
  SettlePayrollRunUseCase,
} from '../../../application/index.js';
import type { Command, CommandContext } from '../command.js';
import { presentPayrollRun, presentPayrollRuns } from '../presenters/payroll-run.presenter.js';
import { presentTreasury } from '../presenters/treasury.presenter.js';

export class OpenPayrollRunCommand implements Command {
  readonly name = 'payroll:open';
  readonly summary = 'calculate a payroll run for a period (moves no money)';
  readonly usage = 'payroll:open --from <iso-date> --to <iso-date> [--json]';

  constructor(private readonly useCase: OpenPayrollRunUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const run = await this.useCase.execute({
      periodStart: args.requireString('from'),
      periodEnd: args.requireString('to'),
    });

    out.write(presentPayrollRun(run, args.flag('json')));
  }
}

export class ApprovePayrollRunCommand implements Command {
  readonly name = 'payroll:approve';
  readonly summary = 'sign off a run so it can be settled (also retries a failed run)';
  readonly usage = 'payroll:approve --id <run-id> [--json]';

  constructor(private readonly useCase: ApprovePayrollRunUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const run = await this.useCase.execute({ runId: args.requireString('id') });

    out.write(presentPayrollRun(run, args.flag('json')));
  }
}

export class SettlePayrollRunCommand implements Command {
  readonly name = 'payroll:settle';
  readonly summary = 'pay an approved run on chain';
  readonly usage = 'payroll:settle --id <run-id> [--json]';

  constructor(private readonly useCase: SettlePayrollRunUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const run = await this.useCase.execute({ runId: args.requireString('id') });

    out.write(presentPayrollRun(run, args.flag('json')));
  }
}

export class ShowPayrollRunCommand implements Command {
  readonly name = 'payroll:show';
  readonly summary = 'show one payroll run and its payslips';
  readonly usage = 'payroll:show --id <run-id> [--json]';

  constructor(private readonly useCase: GetPayrollRunUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const run = await this.useCase.execute({ runId: args.requireString('id') });

    out.write(presentPayrollRun(run, args.flag('json')));
  }
}

export class ListPayrollRunsCommand implements Command {
  readonly name = 'payroll:list';
  readonly summary = 'list payroll runs, most recent first';
  readonly usage = 'payroll:list [--json]';

  constructor(private readonly useCase: ListPayrollRunsUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const runs = await this.useCase.execute();

    out.write(presentPayrollRuns(runs, args.flag('json')));
  }
}

export class InspectTreasuryCommand implements Command {
  readonly name = 'treasury:show';
  readonly summary = 'show the treasury address and available balance';
  readonly usage = 'treasury:show [--json]';

  constructor(private readonly useCase: InspectTreasuryUseCase) {}

  async run({ args, out }: CommandContext): Promise<void> {
    const treasury = await this.useCase.execute();

    out.write(presentTreasury(treasury, args.flag('json')));
  }
}
