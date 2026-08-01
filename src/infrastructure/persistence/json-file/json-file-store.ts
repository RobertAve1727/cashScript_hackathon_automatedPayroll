import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * A JSON array on disk, read and written whole.
 *
 * Two properties matter and both are easy to get wrong:
 *
 *  - **Atomic writes.** Content goes to a temporary file which is then renamed
 *    over the target. `rename` is atomic on POSIX, so a crash mid-write leaves
 *    the previous roster intact rather than a truncated file. Payroll data is
 *    not something to lose to a badly timed Ctrl-C.
 *
 *  - **Serialised mutations.** Every read-modify-write goes through one promise
 *    chain, so two concurrent `save` calls cannot both read the old array and
 *    write back, silently dropping one of the two changes.
 *
 * It rewrites the entire file per save, which is the right trade at roster
 * scale and the wrong one at a million rows — at which point this class is
 * replaced by a database adapter and nothing outside this folder changes.
 */
export class JsonFileStore<TRow> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async readAll(): Promise<TRow[]> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const parsed: unknown = JSON.parse(contents);

      return Array.isArray(parsed) ? (parsed as TRow[]) : [];
    } catch (error) {
      if (isNotFound(error)) return [];
      throw error;
    }
  }

  /** Read the current rows, transform them, and write the result back. */
  async mutate(change: (rows: TRow[]) => TRow[]): Promise<void> {
    this.queue = this.queue.then(async () => {
      const rows = await this.readAll();
      await this.writeAll(change(rows));
    });

    await this.queue;
  }

  private async writeAll(rows: readonly TRow[]): Promise<void> {
    const temporaryPath = `${this.filePath}.tmp`;

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(rows, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, this.filePath);
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
