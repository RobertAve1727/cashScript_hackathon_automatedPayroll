import { TransactionBuilder, gatherBchUtxos, utils, type SignatureTemplate, type Utxo } from 'cashscript';
import {
  DisbursementFailedError,
  type DisbursementReceipt,
  type DisbursementRequest,
  type PayrollDisbursementGateway,
  type TreasurySummary,
} from '../../application/index.js';
import { CashAddress, Satoshis, type BchNetwork } from '../../domain/index.js';
import type { PayrollTreasuryContract } from './payroll-treasury.factory.js';

/** Tag written to the OP_RETURN output so payroll payments are identifiable on chain. */
const OP_RETURN_TAG = 'PAYROLL';

/**
 * Byte estimates used only to reserve enough input value for the fee. They are
 * deliberately generous: over-reserving sends the surplus back to the treasury
 * as change, while under-reserving fails the transaction.
 */
const TX_OVERHEAD_BYTES = 10;
const P2SH_INPUT_BYTES = 300;
const OUTPUT_BYTES = 40;

export interface CashScriptDisbursementGatewayOptions {
  readonly contract: PayrollTreasuryContract;
  readonly operator: SignatureTemplate;
  readonly network: BchNetwork;
  readonly payoutIntervalBlocks: number;
  readonly feeRateSatsPerByte: number;
}

/**
 * Pays a payroll run from the on-chain treasury.
 *
 * This class is the entire Bitcoin Cash surface of the application. Everything
 * chain-specific — UTXO selection, the relative timelock sequence number,
 * signing, fee estimation, broadcast — is contained here, behind
 * `PayrollDisbursementGateway`. No use case, entity or value object knows that
 * a blockchain is involved.
 *
 * The whole run is paid by **one transaction**: either every employee is paid
 * or none is. A half-settled payroll has no valid representation, so the
 * adapter never creates one.
 */
export class CashScriptDisbursementGateway implements PayrollDisbursementGateway {
  private readonly contract: PayrollTreasuryContract;
  private readonly operator: SignatureTemplate;
  private readonly network: BchNetwork;
  private readonly feeRateSatsPerByte: number;
  /**
   * BIP-68 encoded relative timelock. The contract requires
   * `this.age >= payoutInterval`, and OP_CHECKSEQUENCEVERIFY compares that
   * against the input's sequence number — so this must be set, or every
   * disbursement fails script evaluation.
   */
  private readonly sequence: number;

  constructor(options: CashScriptDisbursementGatewayOptions) {
    this.contract = options.contract;
    this.operator = options.operator;
    this.network = options.network;
    this.feeRateSatsPerByte = options.feeRateSatsPerByte;
    this.sequence = utils.encodeBip68({ blocks: options.payoutIntervalBlocks });
  }

  async summarise(): Promise<TreasurySummary> {
    const spendable = await this.spendableUtxos();

    return {
      address: CashAddress.parse(this.contract.address),
      network: this.network,
      availableFunds: Satoshis.from(spendable.reduce((total, utxo) => total + utxo.satoshis, 0n)),
    };
  }

  async disburse(request: DisbursementRequest): Promise<DisbursementReceipt> {
    if (request.lines.length === 0) {
      throw new DisbursementFailedError('nothing to pay — the run has no payslips');
    }

    try {
      const builder = await this.buildTransaction(request);
      const { feeSats } = builder.calculateTransactionFee();
      const details = await builder.send();

      return { transactionId: details.txid, feePaid: Satoshis.from(feeSats) };
    } catch (error) {
      if (error instanceof DisbursementFailedError) throw error;

      throw new DisbursementFailedError(error instanceof Error ? error.message : String(error), { cause: error });
    }
  }

  private async buildTransaction(request: DisbursementRequest): Promise<TransactionBuilder> {
    const total = request.lines.reduce((sum, line) => sum + line.amount.value, 0n);
    // Payslips + the OP_RETURN marker + the change output back to the treasury.
    const outputCount = request.lines.length + 2;
    const selected = this.selectInputs(await this.spendableUtxos(), total, outputCount);

    const builder = new TransactionBuilder({ provider: this.contract.provider });

    builder.addInputs(selected, this.contract.unlock.disburse(this.operator), { sequence: this.sequence });

    for (const line of request.lines) {
      builder.addOutput({ to: line.recipient.value, amount: line.amount.value });
    }

    builder.addOpReturnOutput([OP_RETURN_TAG, request.reference]);
    builder.addBchChangeOutputIfNeeded({ to: this.contract.address, feeRate: this.feeRateSatsPerByte });

    return builder;
  }

  /**
   * Largest-first selection covering the payslips plus an estimated fee.
   *
   * Selected twice on purpose: the fee depends on how many inputs are chosen,
   * which is not known until after the first pass.
   */
  private selectInputs(available: Utxo[], total: bigint, outputCount: number): Utxo[] {
    const firstPass = gatherBchUtxos(available, total + this.estimateFee(1, outputCount));
    if (firstPass.utxos.length <= 1) return firstPass.utxos;

    return gatherBchUtxos(available, total + this.estimateFee(firstPass.utxos.length, outputCount)).utxos;
  }

  private estimateFee(inputCount: number, outputCount: number): bigint {
    const size = TX_OVERHEAD_BYTES + inputCount * P2SH_INPUT_BYTES + outputCount * OUTPUT_BYTES;

    return BigInt(Math.ceil(size * this.feeRateSatsPerByte));
  }

  /** Token UTXOs are not payroll money and must never be spent as fee or change. */
  private async spendableUtxos(): Promise<Utxo[]> {
    const utxos = await this.contract.getUtxos();

    return utxos.filter((utxo) => utxo.token === undefined);
  }
}
