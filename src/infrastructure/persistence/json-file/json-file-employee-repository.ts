import { join } from 'node:path';
import {
  Employee,
  EmploymentStatus,
  type CashAddress,
  type EmployeeId,
  type EmployeeRepository,
  type EmployeeSnapshot,
} from '../../../domain/index.js';
import { JsonFileStore } from './json-file-store.js';

/**
 * Employee storage in `<dataDirectory>/employees.json`.
 *
 * The aggregate's own `toSnapshot` / `fromSnapshot` are the serialisation
 * format — there is no separate ORM model or mapping layer to drift out of
 * sync, and the persisted shape is a contract the domain owns.
 */
export class JsonFileEmployeeRepository implements EmployeeRepository {
  private readonly store: JsonFileStore<EmployeeSnapshot>;

  constructor(dataDirectory: string) {
    this.store = new JsonFileStore<EmployeeSnapshot>(join(dataDirectory, 'employees.json'));
  }

  async save(employee: Employee): Promise<void> {
    const row = employee.toSnapshot();

    await this.store.mutate((rows) => {
      const index = rows.findIndex((candidate) => candidate.id === row.id);
      if (index === -1) return [...rows, row];

      return rows.map((candidate, position) => (position === index ? row : candidate));
    });
  }

  async findById(id: EmployeeId): Promise<Employee | null> {
    const rows = await this.store.readAll();
    const row = rows.find((candidate) => candidate.id === id.value);

    return row === undefined ? null : Employee.fromSnapshot(row);
  }

  async findAll(): Promise<Employee[]> {
    const rows = await this.store.readAll();

    return rows.map((row) => Employee.fromSnapshot(row));
  }

  async findPayable(): Promise<Employee[]> {
    const rows = await this.store.readAll();

    return rows.filter((row) => row.status === EmploymentStatus.Active).map((row) => Employee.fromSnapshot(row));
  }

  async findByPayoutAddress(address: CashAddress): Promise<Employee | null> {
    const rows = await this.store.readAll();
    const row = rows.find((candidate) => candidate.payoutAddress === address.value);

    return row === undefined ? null : Employee.fromSnapshot(row);
  }
}
