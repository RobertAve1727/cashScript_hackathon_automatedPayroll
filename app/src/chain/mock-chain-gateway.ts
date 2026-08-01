import {
  commitmentFromHex,
  commitmentToHex,
  decodeCommitment,
  encodeCommitment,
  type EmploymentCommitment,
} from '@domain/payroll/commitment';
import {
  EMPLOYMENT_STATUS_ACTIVE,
  EMPLOYMENT_STATUS_INACTIVE,
  FIXTURES,
  outputLayoutFor,
} from '@domain/payroll/types';
import { computeDeductions } from '@domain/statutory/deductions';

import { MOCK_AGENCIES, mockPayeePkhHex, pkhToMockAddress } from './mock-data';
import type {
  AmendAction,
  AmendResult,
  ChainGateway,
  EmployeeRecord,
  PayrollRun,
  TreasurySnapshot,
  TxOutput,
} from './gateway';
import { bytesToHex, formatPeso } from '../lib/format';
import { load, save, STORAGE_KEYS } from './persistence';

/**
 * The in-memory chain. Same category, same commitment bytes, same output
 * order, same arithmetic as chipnet — computeDeductions() and
 * outputLayoutFor() come straight from the domain layer, so the numbers a
 * judge sees here are the numbers the covenant enforces.
 */

interface EmployeeState {
  readonly employeeNo: number;
  name: string;
  position: string;
  /** The NFT commitment, held as its canonical 40 bytes. */
  commitment: Uint8Array;
  history: PayrollRun[];
}

/** Everything that has to survive a reload, in one shape. */
interface PersistedChain {
  treasuryBalance: bigint;
  runCount: number;
  employees: EmployeeState[];
}

const TREASURY_SEED = 150_000_000n; // ₱1,500,000.00 of ePHP funding
const TOKEN_CATEGORY = 'e5a40dc0ffee0000000000000000000000000000000000000000000000000001';
const TREASURY_ADDRESS = 'bchtest:pz0esahod0treasury…covenant';

export class MockChainGateway implements ChainGateway {
  private treasuryBalance = TREASURY_SEED;
  private runCount = 0;
  private employees: EmployeeState[] = [];
  private listeners = new Set<() => void>();

  constructor() {
    // Reload restores the demo where it was left: the treasury drawn down,
    // period counters advanced, payslip history intact. Without this a stray
    // refresh mid-demo silently rewinds every employee to period 1 and
    // refills the treasury, which looks like the payroll never happened.
    const restored = load<PersistedChain>(STORAGE_KEYS.chain);
    if (restored) {
      this.treasuryBalance = restored.treasuryBalance;
      this.runCount = restored.runCount;
      this.employees = restored.employees;
      return;
    }

    for (const fixture of FIXTURES) {
      const record: EmploymentCommitment = {
        payeePkh: commitmentFromHex(mockPayeePkhHex(fixture.employeeNo)),
        monthlyBasic: fixture.monthlyBasic,
        monthlyAllowance: fixture.monthlyAllowance,
        taxPerPeriod: fixture.taxPerPeriod,
        nextPeriod: 1,
        endPeriod: 24,
        status: EMPLOYMENT_STATUS_ACTIVE,
        employeeNo: fixture.employeeNo,
      };
      this.employees.push({
        employeeNo: fixture.employeeNo,
        name: fixture.name,
        position: fixture.position,
        commitment: encodeCommitment(record),
        history: [],
      });
    }
  }

  // ── ChainGateway ───────────────────────────────────────────────────────

  async getTreasury(): Promise<TreasurySnapshot> {
    return {
      ephpBalance: this.treasuryBalance,
      tokenCategory: TOKEN_CATEGORY,
      address: TREASURY_ADDRESS,
      runCount: this.runCount,
    };
  }

  async getEmployees(): Promise<readonly EmployeeRecord[]> {
    return this.employees.map((employee) => this.toRecord(employee));
  }

  async runPayroll(employeeNo: number): Promise<PayrollRun> {
    const employee = this.findEmployee(employeeNo);
    const record = decodeCommitment(employee.commitment);

    if (record.status !== EMPLOYMENT_STATUS_ACTIVE) {
      throw new Error(`${employee.name} is suspended/separated — the covenant refuses status 0.`);
    }
    if (record.nextPeriod > record.endPeriod) {
      throw new Error(
        `${employee.name}'s contract window is exhausted (period ${record.nextPeriod} > end ${record.endPeriod}).`,
      );
    }

    const deductions = computeDeductions({
      monthlyBasic: record.monthlyBasic,
      monthlyAllowance: record.monthlyAllowance,
      taxPerPeriod: record.taxPerPeriod,
    });

    if (deductions.totalDrawn > this.treasuryBalance) {
      throw new Error(
        `Treasury holds ${formatPeso(this.treasuryBalance)} but this run draws ${formatPeso(deductions.totalDrawn)}.`,
      );
    }

    const layout = outputLayoutFor(record.taxPerPeriod);
    const treasuryBefore = this.treasuryBalance;
    const treasuryAfter = treasuryBefore - deductions.totalDrawn;

    // Advance the monotonic period counter — the anti-double-payment step.
    const advanced = encodeCommitment({ ...record, nextPeriod: record.nextPeriod + 1 });

    const outputs: TxOutput[] = [
      {
        index: layout.employee,
        kind: 'net',
        label: `${employee.name} — net pay`,
        recipient: pkhToMockAddress(bytesToHex(record.payeePkh)),
        ephp: deductions.net,
        detail: 'P2PKH from the commitment payeePkh — untouchable by whoever triggers payroll',
      },
      {
        index: layout.sss,
        kind: 'sss',
        label: 'SSS remittance',
        recipient: MOCK_AGENCIES.sss,
        ephp: deductions.sssTotal,
        detail: `EE ${formatPeso(deductions.sssEE)} + ER ${formatPeso(deductions.sssER)} + EC ${formatPeso(deductions.sssEC)}`,
      },
      {
        index: layout.philhealth,
        kind: 'philhealth',
        label: 'PhilHealth remittance',
        recipient: MOCK_AGENCIES.philhealth,
        ephp: deductions.phicTotal,
        detail: `EE ${formatPeso(deductions.phicEE)} + ER ${formatPeso(deductions.phicER)}`,
      },
      {
        index: layout.pagibig,
        kind: 'pagibig',
        label: 'Pag-IBIG remittance',
        recipient: MOCK_AGENCIES.pagibig,
        ephp: deductions.hdmfTotal,
        detail: `EE ${formatPeso(deductions.hdmfEE)} + ER ${formatPeso(deductions.hdmfER)}`,
      },
    ];

    if (layout.bir !== null) {
      outputs.push({
        index: layout.bir,
        kind: 'bir',
        label: 'BIR withholding tax',
        recipient: MOCK_AGENCIES.bir,
        ephp: deductions.tax,
        detail: 'HR-computed under TRAIN; the covenant enforces this exact amount',
      });
    }

    outputs.push(
      {
        index: layout.employmentNft,
        kind: 'nft',
        label: `Employment NFT — period ${record.nextPeriod} → ${record.nextPeriod + 1}`,
        recipient: 'EmploymentVault covenant',
        ephp: null,
        detail: commitmentToHex(advanced),
      },
      {
        index: layout.treasuryChange,
        kind: 'change',
        label: 'Treasury change',
        recipient: TREASURY_ADDRESS,
        ephp: treasuryAfter,
        detail: 'Remaining ePHP locked back under the same covenant',
      },
    );

    const run: PayrollRun = {
      txid: mockTxid(),
      employeeNo,
      employeeName: employee.name,
      period: record.nextPeriod,
      executedAt: Date.now(),
      deductions,
      layout,
      outputs,
      treasuryBefore,
      treasuryAfter,
    };

    employee.commitment = advanced;
    employee.history = [run, ...employee.history];
    this.treasuryBalance = treasuryAfter;
    this.runCount += 1;
    this.notify();

    return run;
  }

  async amend(employeeNo: number, action: AmendAction): Promise<AmendResult> {
    const employee = this.findEmployee(employeeNo);
    const before = decodeCommitment(employee.commitment);

    let after: EmploymentCommitment;
    switch (action.kind) {
      case 'terms':
        after = {
          ...before,
          monthlyBasic: action.monthlyBasic,
          monthlyAllowance: action.monthlyAllowance,
          taxPerPeriod: action.taxPerPeriod,
        };
        break;
      case 'suspend':
        after = { ...before, status: EMPLOYMENT_STATUS_INACTIVE };
        break;
      case 'reinstate':
        after = { ...before, status: EMPLOYMENT_STATUS_ACTIVE };
        break;
      case 'separate':
        // Status off AND the window closed behind them — permanent by shape.
        after = {
          ...before,
          status: EMPLOYMENT_STATUS_INACTIVE,
          endPeriod: Math.max(0, before.nextPeriod - 1),
        };
        break;
    }

    const beforeHex = commitmentToHex(employee.commitment);
    const encoded = encodeCommitment(after);
    employee.commitment = encoded;
    this.notify();

    return {
      employeeNo,
      action: action.kind,
      before,
      after,
      beforeHex,
      afterHex: commitmentToHex(encoded),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── Mock-only: NFT genesis. On chipnet this is HR's issuance ceremony. ──

  issue(input: {
    name: string;
    position: string;
    payeePkh: Uint8Array;
    monthlyBasic: bigint;
    monthlyAllowance: bigint;
    taxPerPeriod: bigint;
    endPeriod: number;
  }): EmployeeRecord {
    const employeeNo = 1000 + this.employees.length + 1;
    const commitment = encodeCommitment({
      payeePkh: input.payeePkh,
      monthlyBasic: input.monthlyBasic,
      monthlyAllowance: input.monthlyAllowance,
      taxPerPeriod: input.taxPerPeriod,
      nextPeriod: 1,
      endPeriod: input.endPeriod,
      status: EMPLOYMENT_STATUS_ACTIVE,
      employeeNo,
    });
    const state: EmployeeState = {
      employeeNo,
      name: input.name,
      position: input.position || 'Employee',
      commitment,
      history: [],
    };
    this.employees.push(state);
    this.notify();

    return this.toRecord(state);
  }

  // ── Internals ──────────────────────────────────────────────────────────

  private toRecord(employee: EmployeeState): EmployeeRecord {
    return {
      employeeNo: employee.employeeNo,
      name: employee.name,
      position: employee.position,
      commitment: decodeCommitment(employee.commitment),
      commitmentHex: commitmentToHex(employee.commitment),
      history: employee.history,
    };
  }

  private findEmployee(employeeNo: number): EmployeeState {
    const found = this.employees.find((employee) => employee.employeeNo === employeeNo);
    if (!found) throw new Error(`No employment NFT for employee #${employeeNo}.`);
    return found;
  }

  /**
   * Every mutating path ends here, so persistence hangs off the same call
   * that tells the screens to re-render. A save the UI does not know about,
   * or a re-render that is not saved, would be a state the two disagree on.
   */
  private notify(): void {
    save(STORAGE_KEYS.chain, {
      treasuryBalance: this.treasuryBalance,
      runCount: this.runCount,
      employees: this.employees,
    } satisfies PersistedChain);

    for (const listener of this.listeners) listener();
  }
}

function mockTxid(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

/** The one gateway instance the screens share. Swap here for chipnet. */
export const chainGateway = new MockChainGateway();
