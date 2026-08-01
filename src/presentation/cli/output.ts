/**
 * Where command results go.
 *
 * A port, not `console.log`, so CLI behaviour can be asserted in tests without
 * capturing global stdout.
 */
export interface Output {
  write(text: string): void;
}

export class StdoutOutput implements Output {
  write(text: string): void {
    process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
  }
}

/** Collects output in memory. Used by the CLI tests. */
export class BufferedOutput implements Output {
  readonly lines: string[] = [];

  write(text: string): void {
    this.lines.push(text);
  }

  get text(): string {
    return this.lines.join('\n');
  }
}
