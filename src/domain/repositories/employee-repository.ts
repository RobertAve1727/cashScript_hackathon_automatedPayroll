import type { Employee } from '../entities/employee.js';
import type { CashAddress } from '../value-objects/cash-address.js';
import type { EmployeeId } from '../value-objects/employee-id.js';

/**
 * Persistence port for the `Employee` aggregate.
 *
 * The interface lives in the domain and is implemented in infrastructure — that
 * inversion is what keeps the dependency arrow pointing inwards. Note that it
 * speaks in aggregates and value objects, never in rows, documents or SQL: a
 * Postgres adapter and the in-memory one must both be able to satisfy it.
 */
export interface EmployeeRepository {
  /** Insert or update — the aggregate is the unit of persistence. */
  save(employee: Employee): Promise<void>;

  findById(id: EmployeeId): Promise<Employee | null>;

  /** Whole roster, including suspended and offboarded people. */
  findAll(): Promise<Employee[]>;

  /** Only employees eligible for a payroll run. */
  findPayable(): Promise<Employee[]>;

  /** Used to keep payout addresses unique across the roster. */
  findByPayoutAddress(address: CashAddress): Promise<Employee | null>;
}
