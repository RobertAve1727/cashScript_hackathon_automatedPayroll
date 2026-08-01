import { ApplicationError } from '../../application/index.js';
import { DomainError } from '../../domain/index.js';
import type { Command } from './command.js';
import type { Output } from './output.js';
import { ParsedArgs } from './parsed-args.js';
import { UsageError } from './usage.error.js';

export const ExitCode = {
  Ok: 0,
  /** A business rule said no. The message is meant for the operator. */
  Failed: 1,
  /** The command line was wrong. */
  Usage: 2,
  /** Something unexpected — a bug or an unreachable dependency. */
  Internal: 70,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

/**
 * Dispatches a command line to a command and turns errors into exit codes.
 *
 * The only place in the project that decides *how failure looks*. Because
 * domain and application errors carry stable `code` values, this mapping is
 * total and needs no knowledge of individual use cases — a new use case with a
 * new error is presented correctly without touching this file.
 */
export class CliApplication {
  private readonly commands: ReadonlyMap<string, Command>;

  constructor(
    commands: readonly Command[],
    private readonly out: Output,
    private readonly errorOut: Output,
  ) {
    this.commands = new Map(commands.map((command) => [command.name, command]));
  }

  async run(argv: readonly string[]): Promise<ExitCode> {
    const name = argv[0];

    if (name === undefined || name === 'help' || name === '--help' || name === '-h') {
      this.out.write(this.help());
      return ExitCode.Ok;
    }

    const command = this.commands.get(name);
    if (command === undefined) {
      this.errorOut.write(`unknown command "${name}"\n\n${this.help()}`);
      return ExitCode.Usage;
    }

    try {
      await command.run({ args: ParsedArgs.parse(argv.slice(1)), out: this.out });
      return ExitCode.Ok;
    } catch (error) {
      return this.presentError(error, command);
    }
  }

  private presentError(error: unknown, command: Command): ExitCode {
    if (error instanceof UsageError) {
      this.errorOut.write(`${error.message}\n\nusage: ${error.usage ?? command.usage}`);
      return ExitCode.Usage;
    }

    if (error instanceof ApplicationError || error instanceof DomainError) {
      this.errorOut.write(`${error.code}: ${error.message}`);
      return ExitCode.Failed;
    }

    const message = error instanceof Error ? error.message : String(error);
    this.errorOut.write(`unexpected failure: ${message}`);

    return ExitCode.Internal;
  }

  private help(): string {
    const width = Math.max(...[...this.commands.keys()].map((name) => name.length));
    const lines = [...this.commands.values()].map(
      (command) => `  ${command.name.padEnd(width)}  ${command.summary}`,
    );

    return ['usage: payroll <command> [options]', '', 'commands:', ...lines, '', 'run "payroll help" for this list.'].join(
      '\n',
    );
  }
}
