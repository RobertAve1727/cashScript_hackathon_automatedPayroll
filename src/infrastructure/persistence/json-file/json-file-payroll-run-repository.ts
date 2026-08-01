import { join } from 'node:path';
import {
  PayrollRun,
  type PayrollPeriod,
  type PayrollRunId,
  type PayrollRunRepository,
  type PayrollRunSnapshot,
} from '../../../domain/index.js';
import { JsonFileStore } from './json-file-store.js';

/** Payroll run storage in `<dataDirectory>/payroll-runs.json`. */
export class JsonFilePayrollRunRepository implements PayrollRunRepository {
  private readonly store: JsonFileStore<PayrollRunSnapshot>;

  constructor(dataDirectory: string) {
    this.store = new JsonFileStore<PayrollRunSnapshot>(join(dataDirectory, 'payroll-runs.json'));
  }

  async save(run: PayrollRun): Promise<void> {
    const row = run.toSnapshot();

    await this.store.mutate((rows) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index === -1) return [...rows, row];

      return rows.map((candidate, position) => (position === index ? row : candidate));
    });
  }

  async findById(id: PayrollRunId): Promise<PayrollRun | null> {
    const rows = await this.store.readAll();
    const row = rows.find((candidate) => candidate.id === id.value);

    return row === undefined ? null : PayrollRun.fromSnapshot(row);
  }

  async findOverlapping(period: PayrollPeriod): Promise<PayrollRun[]> {
    const rows = await this.store.readAll();

    return rows.map((row) => PayrollRun.fromSnapshot(row)).filter((run) => run.period.overlaps(period));
  }

  async findAll(): Promise<PayrollRun[]> {
    const rows = await this.store.readAll();

    return rows
      .map((row) => PayrollRun.fromSnapshot(row))
      .sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime());
  }
}
