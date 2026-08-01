import { UsageError } from './usage.error.js';

/**
 * A dependency-free parser for `--flag`, `--key value` and `--key=value`.
 *
 * Written by hand rather than pulled from npm: argument parsing is a delivery
 * detail, and a hundred lines here keeps the whole project at four production
 * dependencies. Swap in a library by changing this file alone.
 */
export class ParsedArgs {
  private constructor(
    private readonly positionals: readonly string[],
    private readonly options: ReadonlyMap<string, string | boolean>,
  ) {}

  static parse(argv: readonly string[]): ParsedArgs {
    const positionals: string[] = [];
    const options = new Map<string, string | boolean>();

    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === undefined) continue;

      if (!token.startsWith('--')) {
        positionals.push(token);
        continue;
      }

      const body = token.slice(2);
      const equals = body.indexOf('=');

      if (equals !== -1) {
        options.set(body.slice(0, equals), body.slice(equals + 1));
        continue;
      }

      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        options.set(body, true);
      } else {
        options.set(body, next);
        index += 1;
      }
    }

    return new ParsedArgs(positionals, options);
  }

  positional(index: number): string | undefined {
    return this.positionals[index];
  }

  string(name: string): string | undefined {
    const value = this.options.get(name);

    return typeof value === 'string' ? value : undefined;
  }

  requireString(name: string): string {
    const value = this.string(name);
    if (value === undefined || value.length === 0) {
      throw new UsageError(`missing required option --${name}`);
    }

    return value;
  }

  number(name: string): number | undefined {
    const value = this.string(name);
    if (value === undefined) return undefined;

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      throw new UsageError(`--${name} must be a number, got "${value}"`);
    }

    return parsed;
  }

  flag(name: string): boolean {
    return this.options.get(name) === true;
  }
}
