import { BchNetwork } from '../../domain/index.js';
import { ConfigurationError } from './configuration.error.js';

export const PersistenceMode = {
  /** Nothing survives the process. Useful for demos and tests. */
  Memory: 'memory',
  /** JSON files under the data directory. */
  File: 'file',
} as const;

export type PersistenceMode = (typeof PersistenceMode)[keyof typeof PersistenceMode];

export const ChainMode = {
  /** In-process UTXO set — no network, no real money. */
  Mock: 'mock',
  /** A real Electrum server on the configured network. */
  Electrum: 'electrum',
} as const;

export type ChainMode = (typeof ChainMode)[keyof typeof ChainMode];

export interface PayrollConfiguration {
  readonly network: BchNetwork;
  readonly chain: ChainMode;
  readonly persistence: PersistenceMode;
  readonly dataDirectory: string;
  /** Payroll operator key, WIF encoded. Required on a real network. */
  readonly operatorWif: string | null;
  /** Treasurer public key hash, 20 bytes hex. Required on a real network. */
  readonly treasurerPublicKeyHash: string | null;
  /** Blocks that must pass before a treasury coin can be spent again. */
  readonly payoutIntervalBlocks: number;
  readonly feeRateSatsPerByte: number;
}

const NETWORKS: Readonly<Record<string, BchNetwork>> = {
  mainnet: BchNetwork.Mainnet,
  testnet: BchNetwork.Testnet,
  regtest: BchNetwork.Regtest,
};

const HEX_20_BYTES = /^[0-9a-f]{40}$/;

/**
 * Reads and validates process configuration in one place.
 *
 * Everything downstream receives a `PayrollConfiguration`, never `process.env` —
 * so nothing but this file has to cope with a string that might be undefined,
 * and misconfiguration surfaces at start-up with the variable name attached.
 */
export function loadPayrollConfiguration(source: NodeJS.ProcessEnv = process.env): PayrollConfiguration {
  const network = readEnum('PAYROLL_NETWORK', source['PAYROLL_NETWORK'], NETWORKS, BchNetwork.Testnet);
  const chain = readEnum(
    'PAYROLL_CHAIN',
    source['PAYROLL_CHAIN'],
    { mock: ChainMode.Mock, electrum: ChainMode.Electrum },
    ChainMode.Mock,
  );
  const persistence = readEnum(
    'PAYROLL_PERSISTENCE',
    source['PAYROLL_PERSISTENCE'],
    { memory: PersistenceMode.Memory, file: PersistenceMode.File },
    PersistenceMode.File,
  );

  const operatorWif = readOptional(source['PAYROLL_OPERATOR_WIF']);
  const treasurerPublicKeyHash = readOptional(source['PAYROLL_TREASURER_PKH'])?.toLowerCase() ?? null;

  // Real money demands real keys; the mock chain may generate its own.
  if (chain === ChainMode.Electrum) {
    if (operatorWif === null) {
      throw new ConfigurationError('PAYROLL_OPERATOR_WIF', 'is required when PAYROLL_CHAIN=electrum');
    }
    if (treasurerPublicKeyHash === null) {
      throw new ConfigurationError('PAYROLL_TREASURER_PKH', 'is required when PAYROLL_CHAIN=electrum');
    }
  }
  if (treasurerPublicKeyHash !== null && !HEX_20_BYTES.test(treasurerPublicKeyHash)) {
    throw new ConfigurationError('PAYROLL_TREASURER_PKH', 'must be 40 hex characters (a 20-byte hash160)');
  }

  return {
    network,
    chain,
    persistence,
    dataDirectory: readOptional(source['PAYROLL_DATA_DIR']) ?? '.payroll-data',
    operatorWif,
    treasurerPublicKeyHash,
    payoutIntervalBlocks: readInteger('PAYROLL_PAYOUT_INTERVAL_BLOCKS', source['PAYROLL_PAYOUT_INTERVAL_BLOCKS'], 1, {
      min: 0,
      max: 65_535,
    }),
    feeRateSatsPerByte: readInteger('PAYROLL_FEE_RATE', source['PAYROLL_FEE_RATE'], 1, { min: 1, max: 1_000 }),
  };
}

function readOptional(raw: string | undefined): string | null {
  const trimmed = raw?.trim() ?? '';
  return trimmed.length === 0 ? null : trimmed;
}

function readEnum<TValue extends string>(
  variable: string,
  raw: string | undefined,
  allowed: Readonly<Record<string, TValue>>,
  fallback: TValue,
): TValue {
  const value = readOptional(raw);
  if (value === null) return fallback;

  const resolved = allowed[value.toLowerCase()];
  if (resolved === undefined) {
    throw new ConfigurationError(variable, `"${value}" is not one of ${Object.keys(allowed).join(', ')}`);
  }

  return resolved;
}

function readInteger(
  variable: string,
  raw: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const value = readOptional(raw);
  if (value === null) return fallback;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    throw new ConfigurationError(variable, `"${value}" must be a whole number between ${bounds.min} and ${bounds.max}`);
  }

  return parsed;
}
