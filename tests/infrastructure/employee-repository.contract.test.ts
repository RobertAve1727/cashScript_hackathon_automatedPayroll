import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CashAddress, EmployeeId, Satoshis, type EmployeeRepository } from '../../src/domain/index.js';
import { InMemoryEmployeeRepository, JsonFileEmployeeRepository } from '../../src/infrastructure/index.js';
import { ALICE_TESTNET, BOB_TESTNET, CAROL_TESTNET } from '../support/addresses.js';
import { anEmployee } from '../support/builders.js';

/**
 * One suite, every `EmployeeRepository` implementation.
 *
 * A port is only trustworthy if its adapters are interchangeable, so the
 * contract is written once and run against each. When a Postgres adapter is
 * added, it joins this list and either passes or is not finished.
 */
function describeEmployeeRepository(
  name: string,
  createRepository: () => Promise<EmployeeRepository> | EmployeeRepository,
  cleanUp: () => Promise<void> = async () => undefined,
): void {
  describe(name, () => {
    let repository: EmployeeRepository;

    beforeEach(async () => {
      repository = await createRepository();
    });

    afterEach(async () => {
      await cleanUp();
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById(EmployeeId.of('missing'))).toBeNull();
    });

    it('saves and reads back an employee', async () => {
      await repository.save(anEmployee({ id: 'emp-1', salaryBch: '0.75', withholdingBps: 500 }));

      const found = await repository.findById(EmployeeId.of('emp-1'));

      expect(found?.fullName).toBe('Alice Rivera');
      expect(found?.salaryPerPeriod.toBchString()).toBe('0.75');
      expect(found?.withholding.value).toBe(500);
    });

    it('updates in place rather than duplicating', async () => {
      const employee = anEmployee({ id: 'emp-1' });
      await repository.save(employee);

      employee.changeSalary(Satoshis.fromBch('2'));
      await repository.save(employee);

      expect(await repository.findAll()).toHaveLength(1);
      expect((await repository.findById(EmployeeId.of('emp-1')))?.salaryPerPeriod.toBchString()).toBe('2');
    });

    it('does not leak later in-memory mutations into storage', async () => {
      const employee = anEmployee({ id: 'emp-1' });
      await repository.save(employee);

      // Changed but never saved — storage must not see it.
      employee.changeSalary(Satoshis.fromBch('99'));

      expect((await repository.findById(EmployeeId.of('emp-1')))?.salaryPerPeriod.toBchString()).toBe('0.5');
    });

    it('lists everyone but reports only active employees as payable', async () => {
      const suspended = anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET });
      suspended.suspend();
      const offboarded = anEmployee({ id: 'emp-3', payoutAddress: CAROL_TESTNET });
      offboarded.offboard();

      await repository.save(anEmployee({ id: 'emp-1' }));
      await repository.save(suspended);
      await repository.save(offboarded);

      expect(await repository.findAll()).toHaveLength(3);
      expect((await repository.findPayable()).map((employee) => employee.id.value)).toEqual(['emp-1']);
    });

    it('finds an employee by payout address', async () => {
      await repository.save(anEmployee({ id: 'emp-1', payoutAddress: ALICE_TESTNET }));

      const found = await repository.findByPayoutAddress(CashAddress.parse(ALICE_TESTNET));

      expect(found?.id.value).toBe('emp-1');
      expect(await repository.findByPayoutAddress(CashAddress.parse(BOB_TESTNET))).toBeNull();
    });
  });
}

describeEmployeeRepository('InMemoryEmployeeRepository', () => new InMemoryEmployeeRepository());

let directory: string;
describeEmployeeRepository(
  'JsonFileEmployeeRepository',
  async () => {
    directory = await mkdtemp(join(tmpdir(), 'payroll-employees-'));
    return new JsonFileEmployeeRepository(directory);
  },
  async () => {
    await rm(directory, { recursive: true, force: true });
  },
);
