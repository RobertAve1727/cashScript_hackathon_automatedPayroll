import type { Output } from './output.js';
import type { ParsedArgs } from './parsed-args.js';

export interface CommandContext {
  readonly args: ParsedArgs;
  readonly out: Output;
}

/**
 * One CLI verb.
 *
 * A command parses arguments, calls exactly one use case, and formats the
 * result. It holds no business logic — if a command starts making decisions
 * about money, that decision belongs in a use case or an entity instead.
 */
export interface Command {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;

  run(context: CommandContext): Promise<void>;
}
