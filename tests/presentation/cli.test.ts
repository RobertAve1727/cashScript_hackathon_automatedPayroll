import { beforeEach, describe, expect, it } from 'vitest';
import { BchNetwork, Satoshis } from '../../src/domain/index.js';
import {
  ChainMode,
  InMemoryEmployeeRepository,
  InMemoryPayrollRunRepository,
  PersistenceMode,
  type PayrollConfiguration,
} from '../../src/infrastructure/index.js';
import { composePayrollCli } from '../../src/main/container.js';
import { BufferedOutput, ExitCode } from '../../src/presentation/index.js';
import { ALICE_TESTNET, ALICE_MAINNET, BOB_TESTNET, INVALID_CHECKSUM_TESTNET } from '../support/addresses.js';
import { FixedClock, RecordingLogger, SequentialIdGenerator, StubDisbursementGateway } from '../support/fakes.js';

const CONFIG: PayrollConfiguration = {
  network: BchNetwork.Testnet,
  chain: ChainMode.Mock,
  persistence: PersistenceMode.Memory,
  dataDirectory: '.payroll-data',
  operatorWif: null,
  treasurerPublicKeyHash: null,
  payoutIntervalBlocks: 1,
  feeRateSatsPerByte: 1,
};

const TXID = 'd'.repeat(64);

/**
 * Drives the real composition root — real commands, real use cases, real
 * entities, real address validation — with storage and the chain replaced.
 *
 * This is the test that proves the layering pays off: swapping the two outer
 * adapters is enough to exercise the entire payroll workflow in milliseconds,
 * with no network, no database and no keys.
 */
describe('payroll CLI', () => {
  let out: BufferedOutput;
  let err: BufferedOutput;
  let gateway: StubDisbursementGateway;
  let run: (...argv: string[]) => Promise<number>;

  beforeEach(() => {
    out = new BufferedOutput();
    err = new BufferedOutput();
    gateway = new StubDisbursementGateway({ transactionId: TXID, fee: Satoshis.from(275n) });

    const cli = composePayrollCli(CONFIG, {
      output: out,
      errorOutput: err,
      employees: new InMemoryEmployeeRepository(),
      payrollRuns: new InMemoryPayrollRunRepository(),
      disbursementGateway: gateway,
      clock: new FixedClock(new Date('2026-08-16T09:00:00.000Z')),
      idGenerator: new SequentialIdGenerator('x'),
      logger: new RecordingLogger(),
    });

    run = (...argv) => cli.run(argv);
  });

  const lastJson = <T,>(): T => JSON.parse(out.lines[out.lines.length - 1] ?? 'null') as T;

  const addAlice = async (): Promise<void> => {
    await run('employee:add', '--name', 'Alice Rivera', '--address', ALICE_TESTNET, '--salary', '1', '--json');
  };

  describe('help and dispatch', () => {
    it('lists the commands when invoked with no arguments', async () => {
      expect(await run()).toBe(ExitCode.Ok);
      expect(out.text).toContain('payroll:settle');
    });

    it('rejects an unknown command with a usage exit code', async () => {
      expect(await run('payroll:yolo')).toBe(ExitCode.Usage);
      expect(err.text).toContain('unknown command "payroll:yolo"');
    });

    it('reports a missing option with the command usage', async () => {
      expect(await run('employee:add', '--name', 'Alice')).toBe(ExitCode.Usage);
      expect(err.text).toContain('missing required option --address');
      expect(err.text).toContain('usage: employee:add');
    });
  });

  describe('managing the roster', () => {
    it('enrols an employee', async () => {
      expect(await run('employee:add', '--name', 'Alice', '--address', ALICE_TESTNET, '--salary', '0.5')).toBe(
        ExitCode.Ok,
      );
      expect(out.text).toContain(ALICE_TESTNET);
      expect(out.text).toContain('0.5 BCH');
    });

    it('rejects an address with a bad checksum, using the real validator', async () => {
      expect(
        await run('employee:add', '--name', 'Typo', '--address', INVALID_CHECKSUM_TESTNET, '--salary', '0.5'),
      ).toBe(ExitCode.Failed);
      expect(err.text).toContain('APP.INVALID_PAYOUT_ADDRESS');
    });

    it('rejects a mainnet address on a testnet treasury', async () => {
      expect(await run('employee:add', '--name', 'Alice', '--address', ALICE_MAINNET, '--salary', '0.5')).toBe(
        ExitCode.Failed,
      );
      expect(err.text).toContain('APP.PAYOUT_ADDRESS_NETWORK_MISMATCH');
    });

    it('lists the roster as JSON', async () => {
      await addAlice();
      await run('employee:add', '--name', 'Bob', '--address', BOB_TESTNET, '--salary', '0.25', '--json');

      await run('employee:list', '--json');

      expect(lastJson<{ fullName: string }[]>().map((employee) => employee.fullName)).toEqual([
        'Alice Rivera',
        'Bob',
      ]);
    });

    it('suspends an employee and drops them from the payable list', async () => {
      await addAlice();
      const { id } = lastJson<{ id: string }>();

      expect(await run('employee:status', '--id', id, '--action', 'suspend')).toBe(ExitCode.Ok);

      await run('employee:list', '--payable', '--json');
      expect(lastJson<unknown[]>()).toEqual([]);
    });

    it('rejects an unknown lifecycle action', async () => {
      await addAlice();
      const { id } = lastJson<{ id: string }>();

      expect(await run('employee:status', '--id', id, '--action', 'fire')).toBe(ExitCode.Usage);
      expect(err.text).toContain('unknown action "fire"');
    });

    it('changes salary and withholding', async () => {
      await addAlice();
      const { id } = lastJson<{ id: string }>();

      await run('employee:pay', '--id', id, '--salary', '2', '--withholding-bps', '750', '--json');

      expect(lastJson<{ salaryPerPeriodBch: string; withholding: string }>()).toMatchObject({
        salaryPerPeriodBch: '2',
        withholding: '7.5%',
      });
    });

    it('refuses a no-op pay change', async () => {
      await addAlice();
      const { id } = lastJson<{ id: string }>();

      expect(await run('employee:pay', '--id', id)).toBe(ExitCode.Usage);
      expect(err.text).toContain('nothing to change');
    });
  });

  describe('the payroll workflow', () => {
    const openRun = async (): Promise<string> => {
      await run('payroll:open', '--from', '2026-08-01', '--to', '2026-08-16', '--json');

      return lastJson<{ id: string }>().id;
    };

    it('runs open -> approve -> settle', async () => {
      await addAlice();

      const runId = await openRun();
      expect(lastJson<{ status: string; headcount: number }>()).toMatchObject({ status: 'draft', headcount: 1 });

      expect(await run('payroll:approve', '--id', runId, '--json')).toBe(ExitCode.Ok);
      expect(lastJson<{ status: string }>().status).toBe('approved');

      expect(await run('payroll:settle', '--id', runId, '--json')).toBe(ExitCode.Ok);
      expect(lastJson<{ status: string; settlement: { transactionId: string } }>()).toMatchObject({
        status: 'settled',
        settlement: { transactionId: TXID, feePaidSats: '275' },
      });
    });

    it('pays the employee net amount through the gateway', async () => {
      await run('employee:add', '--name', 'Alice', '--address', ALICE_TESTNET, '--salary', '1', '--withholding-bps', '1000', '--json');
      const runId = await openRun();
      await run('payroll:approve', '--id', runId);
      await run('payroll:settle', '--id', runId);

      const request = gateway.requests[0];
      expect(request?.lines).toHaveLength(1);
      expect(request?.lines[0]?.amount.toString()).toBe('90000000');
      expect(request?.lines[0]?.recipient.value).toBe(ALICE_TESTNET);
    });

    it('will not settle a run that was never approved', async () => {
      await addAlice();
      const runId = await openRun();

      expect(await run('payroll:settle', '--id', runId)).toBe(ExitCode.Failed);
      expect(err.text).toContain('APP.PAYROLL_RUN_NOT_PAYABLE');
      expect(gateway.requests).toHaveLength(0);
    });

    it('will not open a run with nobody to pay', async () => {
      expect(await run('payroll:open', '--from', '2026-08-01', '--to', '2026-08-16')).toBe(ExitCode.Failed);
      expect(err.text).toContain('APP.NO_PAYABLE_EMPLOYEES');
    });

    it('will not open a second run over the same period', async () => {
      await addAlice();
      await openRun();

      expect(await run('payroll:open', '--from', '2026-08-05', '--to', '2026-08-20')).toBe(ExitCode.Failed);
      expect(err.text).toContain('APP.OVERLAPPING_PAYROLL_PERIOD');
    });

    it('reports an unknown run', async () => {
      expect(await run('payroll:show', '--id', 'nope')).toBe(ExitCode.Failed);
      expect(err.text).toContain('APP.PAYROLL_RUN_NOT_FOUND');
    });

    it('lists runs and shows one in detail', async () => {
      await addAlice();
      const runId = await openRun();

      await run('payroll:list');
      expect(out.text).toContain(runId);

      await run('payroll:show', '--id', runId);
      expect(out.text).toContain(runId);
      expect(out.text).toContain(ALICE_TESTNET);
    });
  });

  describe('the treasury', () => {
    it('shows the balance and network', async () => {
      expect(await run('treasury:show', '--json')).toBe(ExitCode.Ok);
      expect(lastJson<{ network: string; availableFundsBch: string }>()).toMatchObject({
        network: 'testnet',
        availableFundsBch: '10',
      });
    });
  });
});
