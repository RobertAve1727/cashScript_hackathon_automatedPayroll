import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import { Satoshis } from './satoshis.js';

export interface SettlementSnapshot {
  readonly reference: string;
  readonly feePaid: string;
  readonly settledAt: string;
}

export interface RecordSettlementProps {
  /** On-chain transaction id that paid the run. */
  readonly reference: string;
  readonly feePaid: Satoshis;
  readonly settledAt: Date;
}

/** A 32-byte txid, hex encoded. */
const REFERENCE_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Proof that a payroll run was paid: the transaction that did it, the miner fee
 * it cost, and when it was broadcast.
 *
 * The domain treats the reference as an opaque settlement receipt — it happens
 * to be a BCH txid, and the format is validated as one, but nothing in the
 * domain interprets it or talks to a chain to check it.
 */
export class Settlement {
  private constructor(
    readonly reference: string,
    readonly feePaid: Satoshis,
    private readonly settledAtMs: number,
  ) {}

  static record(props: RecordSettlementProps): Settlement {
    const reference = props.reference.trim().toLowerCase();
    const settledAtMs = props.settledAt.getTime();

    if (!REFERENCE_PATTERN.test(reference)) {
      throw new InvariantViolationError(
        'Settlement',
        `"${props.reference}" is not a valid transaction reference (expected 64 hex characters)`,
      );
    }
    if (Number.isNaN(settledAtMs)) {
      throw new InvariantViolationError('Settlement', 'settledAt must be a valid date');
    }

    return new Settlement(reference, props.feePaid, settledAtMs);
  }

  static fromSnapshot(snapshot: SettlementSnapshot): Settlement {
    return Settlement.record({
      reference: snapshot.reference,
      feePaid: Satoshis.from(BigInt(snapshot.feePaid)),
      settledAt: new Date(snapshot.settledAt),
    });
  }

  get settledAt(): Date {
    return new Date(this.settledAtMs);
  }

  toSnapshot(): SettlementSnapshot {
    return {
      reference: this.reference,
      feePaid: this.feePaid.toJSON(),
      settledAt: this.settledAt.toISOString(),
    };
  }
}
