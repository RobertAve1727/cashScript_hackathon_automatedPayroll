/** Public surface of the presentation layer — used by the composition root. */

export { CliApplication, ExitCode } from './cli/cli-application.js';
export type { Command, CommandContext } from './cli/command.js';
export { BufferedOutput, StdoutOutput, type Output } from './cli/output.js';
export { ParsedArgs } from './cli/parsed-args.js';
export { UsageError } from './cli/usage.error.js';

export {
  ChangeEmploymentStatusCommand,
  EnrolEmployeeCommand,
  ListEmployeesCommand,
  UpdateEmployeePayCommand,
} from './cli/commands/employee.commands.js';
export {
  ApprovePayrollRunCommand,
  InspectTreasuryCommand,
  ListPayrollRunsCommand,
  OpenPayrollRunCommand,
  SettlePayrollRunCommand,
  ShowPayrollRunCommand,
} from './cli/commands/payroll.commands.js';
