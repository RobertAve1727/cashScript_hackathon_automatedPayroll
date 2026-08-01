import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PayrollRunId } from '../../src/domain/index.js';
import { JsonFilePayrollRunRepository, JsonFileStore } from '../../src/infrastructure/index.js';
import { aPayrollRun, aPeriod } from '../support/builders.js';

interface Row {
  readonly id: string;
}

describe('JsonFileStore', () => {
  let directory: string;
  let filePath: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'payroll-store-'));
    filePath = join(directory, 'nested', 'rows.json');
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('reads an empty list before the file exists', async () => {
    expect(await new JsonFileStore<Row>(filePath).readAll()).toEqual([]);
  });

  it('creates missing directories on write', async () => {
    const store = new JsonFileStore<Row>(filePath);

    await store.mutate(() => [{ id: 'a' }]);

    expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual([{ id: 'a' }]);
  });

  it('serialises concurrent mutations instead of losing writes', async () => {
    const store = new JsonFileStore<Row>(filePath);

    // Without the internal queue these interleave: each reads the same array
    // and the last write wins, dropping the other nine rows.
    await Promise.all(
      Array.from({ length: 10 }, (_, index) => store.mutate((rows) => [...rows, { id: `row-${index}` }])),
    );

    expect(await store.readAll()).toHaveLength(10);
  });

  it('treats a corrupt file as empty rather than crashing on a non-array', async () => {
    await new JsonFileStore<Row>(filePath).mutate(() => [{ id: 'a' }]);
    await writeFile(filePath, '{"not":"an array"}', 'utf8');

    expect(await new JsonFileStore<Row>(filePath).readAll()).toEqual([]);
  });

  it('leaves no temporary file behind', async () => {
    const store = new JsonFileStore<Row>(filePath);
    await store.mutate(() => [{ id: 'a' }]);

    await expect(readFile(`${filePath}.tmp`, 'utf8')).rejects.toThrow(/ENOENT/);
  });
});

describe('JsonFilePayrollRunRepository', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'payroll-runs-'));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('survives a process restart', async () => {
    await new JsonFilePayrollRunRepository(directory).save(aPayrollRun({ id: 'run-1' }));

    const reopened = new JsonFilePayrollRunRepository(directory);

    expect((await reopened.findById(PayrollRunId.of('run-1')))?.headcount).toBe(1);
  });

  it('finds runs whose period overlaps', async () => {
    const repository = new JsonFilePayrollRunRepository(directory);
    await repository.save(aPayrollRun({ id: 'run-1', period: aPeriod() }));

    const overlapping = await repository.findOverlapping(
      aPeriod('2026-08-10T00:00:00.000Z', '2026-08-20T00:00:00.000Z'),
    );
    const adjacent = await repository.findOverlapping(
      aPeriod('2026-08-16T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
    );

    expect(overlapping.map((run) => run.id.value)).toEqual(['run-1']);
    expect(adjacent).toEqual([]);
  });

  it('lists runs most recently opened first', async () => {
    const repository = new JsonFilePayrollRunRepository(directory);
    await repository.save(aPayrollRun({ id: 'older', openedAt: new Date('2026-07-01T00:00:00.000Z') }));
    await repository.save(aPayrollRun({ id: 'newer', openedAt: new Date('2026-08-01T00:00:00.000Z') }));

    expect((await repository.findAll()).map((run) => run.id.value)).toEqual(['newer', 'older']);
  });
});
