import type { EmploymentCommitment } from '@domain/payroll/commitment';
import type { OutputLayout } from '@domain/payroll/types';
import type { Deductions } from '@domain/statutory/deductions';

/**
 * The seam between the screens and the chain.
 *
 * Everything the UI knows about the outside world flows through this
 * interface. `MockChainGateway` implements it over an in-memory store today; a
 * chipnet adapter implements the same four methods over ElectrumNetworkProvider
 * and the real transaction builder tomorrow, and no screen changes.
 */
/**
 * Where a payroll run has got to.
 *
 * Reported rather than guessed. Broadcasting to a real chain takes seconds, and
 * a spinner that says nothing leaves the operator unable to tell a slow network
 * from a wedged one — so each stage is emitted when it actually begins, and a
 * screen showing "Broadcasting" means the request is genuinely in flight.
 */
export type RunStage =
  | 'reading'      // fetching the current treasury and record from the chain
  | 'building'     // assembling the transaction
  | 'broadcasting' // in flight to the network
  | 'confirming';  // re-reading the chain to show the result

export type RunProgress = (stage: RunStage) => void;

export interface ChainGateway {
  getTreasury(): Promise<TreasurySnapshot>;
  getEmployees(): Promise<readonly EmployeeRecord[]>;
  /** Build + broadcast one lawful disbursement for one employee. */
  runPayroll(employeeNo: number, onProgress?: RunProgress): Promise<PayrollRun>;
  /** HR-signed amendment of the employment NFT commitment. */
  amend(employeeNo: number, action: AmendAction): Promise<AmendResult>;
  /**
   * Notify when chain state changes. The mock fires synchronously after each
   * mutation; a chipnet adapter fires from its subscription/polling loop.
   */
  subscribe(listener: () => void): () => void;
}

// ── Read models ──────────────────────────────────────────────────────────

export interface TreasurySnapshot {
  /** Fungible ePHP held by the PayrollTreasury covenant, in centavo units. */
  readonly ephpBalance: bigint;
  /** The CashToken category of ePHP (and of the employment NFTs). */
  readonly tokenCategory: string;
  /** Token-aware address of the treasury covenant. */
  readonly address: string;
  /** Payroll transactions executed so far. */
  readonly runCount: number;
}

export interface EmployeeRecord {
  readonly employeeNo: number;
  readonly name: string;
  readonly position: string;
  /** Decoded 40-byte employment NFT commitment — the employment contract. */
  readonly commitment: EmploymentCommitment;
  /** The same 40 bytes as lowercase hex, exactly as the NFT carries them. */
  readonly commitmentHex: string;
  /** Payroll runs already executed for this employee, newest first. */
  readonly history: readonly PayrollRun[];
}

/** One output of a payroll transaction, in covenant-enforced order. */
export interface TxOutput {
  readonly index: number;
  readonly kind: 'net' | 'sss' | 'philhealth' | 'pagibig' | 'bir' | 'nft' | 'change';
  readonly label: string;
  /** Display form of the receiving address / locking bytecode. */
  readonly recipient: string;
  /** Fungible ePHP riding on this output; null for the NFT output. */
  readonly ephp: bigint | null;
  /** Breakdown or annotation shown under the amount. */
  readonly detail?: string;
}

export interface PayrollRun {
  readonly txid: string;
  readonly employeeNo: number;
  readonly employeeName: string;
  /** The period this run paid — the commitment counter before advancing. */
  readonly period: number;
  readonly executedAt: number;
  readonly deductions: Deductions;
  readonly layout: OutputLayout;
  readonly outputs: readonly TxOutput[];
  readonly treasuryBefore: bigint;
  readonly treasuryAfter: bigint;
}

// ── Amendments ───────────────────────────────────────────────────────────

export type AmendAction =
  | {
      readonly kind: 'terms';
      readonly monthlyBasic: bigint;
      readonly monthlyAllowance: bigint;
      readonly taxPerPeriod: bigint;
    }
  | { readonly kind: 'suspend' }
  | { readonly kind: 'reinstate' }
  | { readonly kind: 'separate' };

export interface AmendResult {
  readonly employeeNo: number;
  readonly action: AmendAction['kind'];
  readonly before: EmploymentCommitment;
  readonly after: EmploymentCommitment;
  readonly beforeHex: string;
  readonly afterHex: string;
}
