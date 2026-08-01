import type { PayrollRun } from '../entities/payroll-run.js';
import type { PayrollPeriod } from '../value-objects/payroll-period.js';
import type { PayrollRunId } from '../value-objects/payroll-run-id.js';

/** Persistence port for the `PayrollRun` aggregate. */
export interface PayrollRunRepository {
  save(run: PayrollRun): Promise<void>;

  findById(id: PayrollRunId): Promise<PayrollRun | null>;

  /**
   * Runs whose period overlaps `period`. Used to stop a period being paid
   * twice under two different run ids.
   */
  findOverlapping(period: PayrollPeriod): Promise<PayrollRun[]>;

  /** Most recently opened first. */
  findAll(): Promise<PayrollRun[]>;
}
