import { beforeEach, describe, expect, it } from 'vitest';
import {
  NoPayableEmployeesError,
  OpenPayrollRunUseCase,
  OverlappingPayrollPeriodError,
} from '../../src/application/index.js';
import { PayrollCalculator } from '../../src/domain/index.js';
import { InMemoryEmployeeRepository, InMemoryPayrollRunRepository } from '../../src/infrastructure/index.js';
import { BOB_TESTNET } from '../support/addresses.js';
import { anEmployee, anApprovedPayrollRun, aPeriod } from '../support/builders.js';
import { FixedClock, RecordingLogger, SequentialIdGenerator } from '../support/fakes.js';

const AUGUST = { periodStart: '2026-08-01T00:00:00.000Z', periodEnd: '2026-08-16T00:00:00.000Z' };

describe('OpenPayrollRunUseCase', () => {
  let runs: InMemoryPayrollRunRepository;
  let employees: InMemoryEmployeeRepository;
  let useCase: OpenPayrollRunUseCase;

  beforeEach(() => {
    runs = new InMemoryPayrollRunRepository();
    employees = new InMemoryEmployeeRepository();
    useCase = new OpenPayrollRunUseCase(
      runs,
      employees,
      new PayrollCalculator(),
      new SequentialIdGenerator('run'),
      new FixedClock(new Date('2026-08-16T09:00:00.000Z')),
      new RecordingLogger(),
    );
  });

  it('opens a draft run covering every payable employee', async () => {
    await employees.save(anEmployee({ id: 'emp-1', salaryBch: '1', withholdingBps: 1_000 }));
    await employees.save(anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET, salaryBch: '0.5' }));

    const run = await useCase.execute(AUGUST);

    expect(run).toMatchObject({
      id: 'run-1',
      status: 'draft',
      headcount: 2,
      periodLabel: '2026-08-01..2026-08-16',
      totalGrossSats: '150000000',
      totalWithheldSats: '10000000',
      totalNetBch: '1.4',
    });
    expect(run.settlement).toBeNull();
  });

  it('leaves out suspended employees', async () => {
    const suspended = anEmployee({ id: 'emp-2', payoutAddress: BOB_TESTNET });
    suspended.suspend();
    await employees.save(anEmployee({ id: 'emp-1' }));
    await employees.save(suspended);

    const run = await useCase.execute(AUGUST);

    expect(run.headcount).toBe(1);
    expect(run.payslips[0]?.employeeId).toBe('emp-1');
  });

  it('persists the run', async () => {
    await employees.save(anEmployee());
    await useCase.execute(AUGUST);

    expect(await runs.findAll()).toHaveLength(1);
  });

  it('refuses to open a run with nobody to pay', async () => {
    await expect(useCase.execute(AUGUST)).rejects.toThrow(NoPayableEmployeesError);
  });

  it('refuses a period overlapping an existing run', async () => {
    await employees.save(anEmployee());
    await runs.save(anApprovedPayrollRun({ period: aPeriod() }));

    await expect(
      useCase.execute({ periodStart: '2026-08-10T00:00:00.000Z', periodEnd: '2026-08-20T00:00:00.000Z' }),
    ).rejects.toThrow(OverlappingPayrollPeriodError);
  });

  it('allows a period that overlaps only a failed run', async () => {
    await employees.save(anEmployee());
    const failed = anApprovedPayrollRun({ period: aPeriod() });
    failed.markFailed('broadcast rejected');
    await runs.save(failed);

    await expect(useCase.execute(AUGUST)).resolves.toMatchObject({ status: 'draft' });
  });

  it('allows a period that starts exactly where the previous one ended', async () => {
    await employees.save(anEmployee());
    await runs.save(anApprovedPayrollRun({ period: aPeriod() }));

    await expect(
      useCase.execute({ periodStart: '2026-08-16T00:00:00.000Z', periodEnd: '2026-09-01T00:00:00.000Z' }),
    ).resolves.toMatchObject({ headcount: 1 });
  });

  it('rejects an inverted period', async () => {
    await employees.save(anEmployee());

    await expect(
      useCase.execute({ periodStart: AUGUST.periodEnd, periodEnd: AUGUST.periodStart }),
    ).rejects.toThrow(/must be after/);
  });
});
