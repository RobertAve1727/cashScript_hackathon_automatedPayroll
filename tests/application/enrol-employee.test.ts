import { beforeEach, describe, expect, it } from 'vitest';
import {
  DuplicatePayoutAddressError,
  EnrolEmployeeUseCase,
  InvalidPayoutAddressError,
  PayoutAddressNetworkMismatchError,
} from '../../src/application/index.js';
import { BchNetwork, EmployeeId, InvariantViolationError } from '../../src/domain/index.js';
import { InMemoryEmployeeRepository } from '../../src/infrastructure/index.js';
import { ALICE_MAINNET, ALICE_TESTNET, BOB_TESTNET } from '../support/addresses.js';
import {
  AcceptingAddressValidator,
  FixedClock,
  RecordingLogger,
  RejectingAddressValidator,
  SequentialIdGenerator,
} from '../support/fakes.js';

describe('EnrolEmployeeUseCase', () => {
  let employees: InMemoryEmployeeRepository;
  let logger: RecordingLogger;
  let clock: FixedClock;

  const buildUseCase = (validator = new AcceptingAddressValidator()): EnrolEmployeeUseCase =>
    new EnrolEmployeeUseCase(
      employees,
      validator,
      new SequentialIdGenerator('emp'),
      clock,
      logger,
      BchNetwork.Testnet,
    );

  beforeEach(() => {
    employees = new InMemoryEmployeeRepository();
    logger = new RecordingLogger();
    clock = new FixedClock(new Date('2026-08-01T09:00:00.000Z'));
  });

  it('enrols an employee and returns a DTO', async () => {
    const employee = await buildUseCase().execute({
      fullName: 'Alice Rivera',
      payoutAddress: ALICE_TESTNET,
      salaryBch: '0.5',
      withholdingBps: 750,
    });

    expect(employee).toMatchObject({
      id: 'emp-1',
      fullName: 'Alice Rivera',
      payoutAddress: ALICE_TESTNET,
      salaryPerPeriodSats: '50000000',
      salaryPerPeriodBch: '0.5',
      withholding: '7.5%',
      status: 'active',
      payable: true,
      enrolledAt: '2026-08-01T09:00:00.000Z',
    });
  });

  it('persists the employee', async () => {
    await buildUseCase().execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' });

    expect(await employees.findById(EmployeeId.of('emp-1'))).not.toBeNull();
    expect(await employees.findPayable()).toHaveLength(1);
  });

  it('defaults withholding to zero', async () => {
    const employee = await buildUseCase().execute({
      fullName: 'Alice',
      payoutAddress: ALICE_TESTNET,
      salaryBch: '0.5',
    });

    expect(employee.withholdingBps).toBe(0);
  });

  it('rejects an address whose checksum does not verify', async () => {
    const useCase = buildUseCase(new RejectingAddressValidator('invalid checksum'));

    await expect(
      useCase.execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' }),
    ).rejects.toThrow(InvalidPayoutAddressError);
  });

  it('rejects a mainnet address when the treasury is on testnet', async () => {
    await expect(
      buildUseCase().execute({ fullName: 'Alice', payoutAddress: ALICE_MAINNET, salaryBch: '0.5' }),
    ).rejects.toThrow(PayoutAddressNetworkMismatchError);
  });

  it('rejects a payout address already used by someone else', async () => {
    const useCase = buildUseCase();
    await useCase.execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' });

    await expect(
      useCase.execute({ fullName: 'Impostor', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' }),
    ).rejects.toThrow(DuplicatePayoutAddressError);
  });

  it('allows a second employee at a different address', async () => {
    const useCase = buildUseCase();
    await useCase.execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' });
    const bob = await useCase.execute({ fullName: 'Bob', payoutAddress: BOB_TESTNET, salaryBch: '0.25' });

    expect(bob.id).toBe('emp-2');
    expect(await employees.findAll()).toHaveLength(2);
  });

  it('propagates domain validation for a malformed salary', async () => {
    await expect(
      buildUseCase().execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: 'lots' }),
    ).rejects.toThrow(InvariantViolationError);
  });

  it('saves nothing when validation fails', async () => {
    await expect(
      buildUseCase().execute({ fullName: '', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' }),
    ).rejects.toThrow(InvariantViolationError);

    expect(await employees.findAll()).toHaveLength(0);
  });

  it('logs the enrolment', async () => {
    await buildUseCase().execute({ fullName: 'Alice', payoutAddress: ALICE_TESTNET, salaryBch: '0.5' });

    expect(logger.messages('info')).toContain('employee enrolled');
  });
});
