import type {
  DisbursementReceipt,
  DisbursementRequest,
  PayrollDisbursementGateway,
  TreasurySummary,
} from '../application/index.js';

/**
 * Defers building the real gateway until a command actually needs the chain.
 *
 * Constructing the CashScript gateway loads the compiled contract artifact and
 * resolves signing keys. Doing that eagerly would make `employee:list` fail on
 * a fresh clone that has not run `contracts:compile` yet — a command that never
 * touches the blockchain should not care that the blockchain is unavailable.
 */
export class LazyDisbursementGateway implements PayrollDisbursementGateway {
  private instance: PayrollDisbursementGateway | null = null;

  constructor(private readonly build: () => PayrollDisbursementGateway) {}

  async summarise(): Promise<TreasurySummary> {
    return this.resolve().summarise();
  }

  async disburse(request: DisbursementRequest): Promise<DisbursementReceipt> {
    return this.resolve().disburse(request);
  }

  private resolve(): PayrollDisbursementGateway {
    this.instance ??= this.build();

    return this.instance;
  }
}
