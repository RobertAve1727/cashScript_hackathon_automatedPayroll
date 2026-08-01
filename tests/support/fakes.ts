import type {
  AddressValidation,
  AddressValidator,
  Clock,
  DisbursementReceipt,
  DisbursementRequest,
  IdGenerator,
  LogContext,
  Logger,
  PayrollDisbursementGateway,
  TreasurySummary,
} from '../../src/application/index.js';
import { BchNetwork, CashAddress, Satoshis } from '../../src/domain/index.js';

/**
 * Hand-written fakes rather than mocking-framework stubs.
 *
 * Each one implements a port the application defines, so these doubles are the
 * proof that the ports are small enough to be implemented in a few lines — a
 * port that is painful to fake is a port that is too big.
 */

export class FixedClock implements Clock {
  constructor(private instant: Date = new Date('2026-08-01T09:00:00.000Z')) {}

  now(): Date {
    return new Date(this.instant);
  }

  set(instant: Date): void {
    this.instant = instant;
  }

  advanceDays(days: number): void {
    this.instant = new Date(this.instant.getTime() + days * 86_400_000);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private counter = 0;

  constructor(private readonly prefix = 'id') {}

  next(): string {
    this.counter += 1;

    return `${this.prefix}-${this.counter}`;
  }
}

export interface LogEntry {
  readonly level: 'info' | 'warn' | 'error';
  readonly message: string;
  readonly context: LogContext | undefined;
}

export class RecordingLogger implements Logger {
  readonly entries: LogEntry[] = [];

  info(message: string, context?: LogContext): void {
    this.entries.push({ level: 'info', message, context });
  }

  warn(message: string, context?: LogContext): void {
    this.entries.push({ level: 'warn', message, context });
  }

  error(message: string, context?: LogContext): void {
    this.entries.push({ level: 'error', message, context });
  }

  messages(level: LogEntry['level']): string[] {
    return this.entries.filter((entry) => entry.level === level).map((entry) => entry.message);
  }
}

export class AcceptingAddressValidator implements AddressValidator {
  validate(): AddressValidation {
    return { ok: true };
  }
}

export class RejectingAddressValidator implements AddressValidator {
  constructor(private readonly reason = 'invalid checksum') {}

  validate(): AddressValidation {
    return { ok: false, reason: this.reason };
  }
}

export interface StubGatewayOptions {
  readonly balance?: Satoshis;
  readonly address?: string;
  readonly network?: BchNetwork;
  readonly transactionId?: string;
  readonly fee?: Satoshis;
  /** When set, `disburse` rejects with this error instead of succeeding. */
  readonly failWith?: Error;
}

const TREASURY_ADDRESS = 'bchtest:qqqqzqsrqszsvpcgpy9qkrqdpc83qygjzvupc7a6v7';
const DEFAULT_TXID = 'a'.repeat(64);

export class StubDisbursementGateway implements PayrollDisbursementGateway {
  readonly requests: DisbursementRequest[] = [];

  constructor(private readonly options: StubGatewayOptions = {}) {}

  async summarise(): Promise<TreasurySummary> {
    return {
      address: CashAddress.parse(this.options.address ?? TREASURY_ADDRESS),
      network: this.options.network ?? BchNetwork.Testnet,
      availableFunds: this.options.balance ?? Satoshis.fromBch('10'),
    };
  }

  async disburse(request: DisbursementRequest): Promise<DisbursementReceipt> {
    this.requests.push(request);

    if (this.options.failWith !== undefined) {
      throw this.options.failWith;
    }

    return {
      transactionId: this.options.transactionId ?? DEFAULT_TXID,
      feePaid: this.options.fee ?? Satoshis.from(500n),
    };
  }
}
