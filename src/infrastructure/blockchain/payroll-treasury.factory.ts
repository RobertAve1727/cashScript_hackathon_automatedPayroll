import { hexToBin } from '@bitauth/libauth';
import { Contract, SignatureTemplate, utils, type NetworkProvider } from 'cashscript';
import { ConfigurationError } from '../config/configuration.error.js';
import { ChainMode, type PayrollConfiguration } from '../config/payroll-configuration.js';
import { loadSimpleBchTreasuryArtifact, type SimpleBchTreasuryArtifact } from './simple-bch-treasury-artifact.js';

export type PayrollTreasuryContract = Contract<SimpleBchTreasuryArtifact>;

export interface TreasuryKeys {
  /** Signs payroll runs. Hot — it is used on every settlement. */
  readonly operator: SignatureTemplate;
  /** Can always sweep the treasury. Cold — only its hash is held here. */
  readonly treasurerPublicKeyHash: Uint8Array;
}

/**
 * Fixed development keys, used only when `PAYROLL_CHAIN=mock`.
 *
 * Deterministic so demo runs reproduce exactly, and hard-refused on a real
 * network by `resolveTreasuryKeys` — a hardcoded key that can reach mainnet is
 * how test funds become real losses.
 */
const DEVELOPMENT_OPERATOR_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const DEVELOPMENT_TREASURER_KEY = Uint8Array.from({ length: 32 }, (_, index) => index + 101);

export function resolveTreasuryKeys(config: PayrollConfiguration): TreasuryKeys {
  if (config.chain === ChainMode.Mock) {
    return {
      operator: new SignatureTemplate(config.operatorWif ?? DEVELOPMENT_OPERATOR_KEY),
      treasurerPublicKeyHash:
        config.treasurerPublicKeyHash === null
          ? utils.hash160(new SignatureTemplate(DEVELOPMENT_TREASURER_KEY).getPublicKey())
          : hexToBin(config.treasurerPublicKeyHash),
    };
  }

  // `loadPayrollConfiguration` already rejects this combination; belt and braces,
  // because the failure mode here is "signs with a key nobody chose".
  if (config.operatorWif === null || config.treasurerPublicKeyHash === null) {
    throw new ConfigurationError('PAYROLL_OPERATOR_WIF', 'real-network operation requires explicit operator and treasurer keys');
  }

  return {
    operator: new SignatureTemplate(config.operatorWif),
    treasurerPublicKeyHash: hexToBin(config.treasurerPublicKeyHash),
  };
}

/**
 * Instantiate the on-chain treasury.
 *
 * The contract address is derived from these three constructor arguments, so
 * changing the payout interval or either key produces a *different* address.
 * That is worth knowing before rotating a key on a funded treasury: sweep with
 * `reclaim` first, then redeploy.
 */
export function createPayrollTreasuryContract(
  config: PayrollConfiguration,
  provider: NetworkProvider,
  keys: TreasuryKeys,
  artifact: SimpleBchTreasuryArtifact = loadSimpleBchTreasuryArtifact(),
): PayrollTreasuryContract {
  return new Contract<SimpleBchTreasuryArtifact>(
    artifact,
    [keys.operator.getPublicKey(), keys.treasurerPublicKeyHash, BigInt(config.payoutIntervalBlocks)],
    { provider },
  );
}
