import {
  PayrollRun,
  type PayrollPeriod,
  type PayrollRunId,
  type PayrollRunRepository,
  type PayrollRunSnapshot,
} from '../../../domain/index.js';

/** Payroll run storage backed by a `Map`. See `InMemoryEmployeeRepository`. */
export class InMemoryPayrollRunRepository implements PayrollRunRepository {
  private readonly rows = new Map<string, PayrollRunSnapshot>();

  constructor(seed: readonly PayrollRunSnapshot[] = []) {
    for (const row of seed) {
      this.rows.set(row.id, row);
    }
  }

  async save(run: PayrollRun): Promise<void> {
    this.rows.set(run.id.value, run.toSnapshot());
  }

  async findById(id: PayrollRunId): Promise<PayrollRun | null> {
    const row = this.rows.get(id.value);

    return row === undefined ? null : PayrollRun.fromSnapshot(row);
  }

  async findOverlapping(period: PayrollPeriod): Promise<PayrollRun[]> {
    return [...this.rows.values()]
      .map((row) => PayrollRun.fromSnapshot(row))
      .filter((run) => run.period.overlaps(period));
  }

  async findAll(): Promise<PayrollRun[]> {
    return [...this.rows.values()]
      .map((row) => PayrollRun.fromSnapshot(row))
      .sort((left, right) => right.openedAt.getTime() - left.openedAt.getTime());
  }
}
