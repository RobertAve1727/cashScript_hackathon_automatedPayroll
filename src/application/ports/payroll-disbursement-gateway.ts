import type { BchNetwork, CashAddress, Satoshis } from '../../domain/index.js';

export interface DisbursementLine {
  readonly recipient: CashAddress;
  readonly amount: Satoshis;
}

export interface DisbursementRequest {
  /** Payroll run id; adapters may record it on chain so a payment is traceable. */
  readonly reference: string;
  readonly lines: readonly DisbursementLine[];
}

export interface DisbursementReceipt {
  /** On-chain transaction id. */
  readonly transactionId: string;
  readonly feePaid: Satoshis;
}

export interface TreasurySummary {
  readonly address: CashAddress;
  readonly network: BchNetwork;
  readonly availableFunds: Satoshis;
}

/**
 * The port through which payroll money actually leaves the company.
 *
 * This is the seam that keeps Bitcoin Cash out of the core: the whole of
 * CashScript, UTXOs, signatures and fee estimation lives behind these two
 * methods. Swapping BCH for a bank API means writing one new adapter and
 * changing one line in the composition root — no use case is touched.
 */
export interface PayrollDisbursementGateway {
  /** Where the money is, how much of it there is, and on which network. */
  summarise(): Promise<TreasurySummary>;

  /**
   * Pay every line, atomically — one transaction, so a run cannot half-settle.
   *
   * @throws DisbursementFailedError if the network rejects the payment.
   */
  disburse(request: DisbursementRequest): Promise<DisbursementReceipt>;
}
