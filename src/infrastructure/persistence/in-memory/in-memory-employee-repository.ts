import {
  Employee,
  EmploymentStatus,
  type CashAddress,
  type EmployeeId,
  type EmployeeRepository,
  type EmployeeSnapshot,
} from '../../../domain/index.js';

/**
 * Employee storage backed by a `Map`.
 *
 * Rows are stored as **snapshots**, not as live `Employee` objects. Handing the
 * same mutable aggregate to two callers would let a change made in one use case
 * appear in another without anyone saving it — which real storage would never
 * do. Rehydrating on every read keeps this adapter honest about that, so tests
 * written against it stay valid when a database replaces it.
 */
export class InMemoryEmployeeRepository implements EmployeeRepository {
  private readonly rows = new Map<string, EmployeeSnapshot>();

  constructor(seed: readonly EmployeeSnapshot[] = []) {
    for (const row of seed) {
      this.rows.set(row.id, row);
    }
  }

  async save(employee: Employee): Promise<void> {
    this.rows.set(employee.id.value, employee.toSnapshot());
  }

  async findById(id: EmployeeId): Promise<Employee | null> {
    const row = this.rows.get(id.value);

    return row === undefined ? null : Employee.fromSnapshot(row);
  }

  async findAll(): Promise<Employee[]> {
    return [...this.rows.values()].map((row) => Employee.fromSnapshot(row));
  }

  async findPayable(): Promise<Employee[]> {
    return [...this.rows.values()]
      .filter((row) => row.status === EmploymentStatus.Active)
      .map((row) => Employee.fromSnapshot(row));
  }

  async findByPayoutAddress(address: CashAddress): Promise<Employee | null> {
    const row = [...this.rows.values()].find((candidate) => candidate.payoutAddress === address.value);

    return row === undefined ? null : Employee.fromSnapshot(row);
  }
}
