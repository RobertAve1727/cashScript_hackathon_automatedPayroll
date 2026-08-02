import { hexToBin } from '@bitauth/libauth';
import { Contract, type NetworkProvider } from 'cashscript';
import { loadEmploymentVaultArtifact, type EmploymentVaultArtifact } from './employment-vault-artifact.js';
import { loadPayrollTreasuryArtifact, type PayrollTreasuryArtifact } from './payroll-treasury-artifact.js';

export type PayrollTreasuryContract = Contract<PayrollTreasuryArtifact>;
export type EmploymentVaultContract = Contract<EmploymentVaultArtifact>;

export interface PayrollTreasuryParams {
  /**
   * The employment NFT category in **display order** — the genesis txid as a
   * block explorer, `Utxo.token.category` and `deployment.json` all spell it.
   * `deployEsahod` reverses it for the covenant; see `toVmCategoryOrder`.
   */
  readonly employmentCategory: Uint8Array;
  /** The ePHP fungible-token category, also in display order. */
  readonly pesoCategory: Uint8Array;
  readonly remitConfigHash: Uint8Array;
  readonly genesisTime: bigint;
  readonly periodSeconds: bigint;
  /**
   * Pay periods in a month — 2 semi-monthly, 4 weekly, 22 daily. The divisor
   * the covenant applies to every monthly figure.
   *
   * It is a CONSTRUCTOR argument, so it is part of the contract's address: one
   * treasury settles one cadence, and a company paying two cadences deploys two
   * treasuries. That is inherent, not a limitation of this code — the address
   * IS the hash of these arguments.
   */
  readonly periodsPerMonth: bigint;
  readonly payrollOfficerPkh: Uint8Array;
  readonly lapseTime: bigint;
}

export interface EsahodDeployment {
  readonly treasury: PayrollTreasuryContract;
  readonly vault: EmploymentVaultContract;
}

/**
 * Convert a token category from display order to the order the BCH VM sees.
 *
 * These are opposite. A category is a genesis txid, and txids are displayed
 * reversed from their serialised bytes; libauth pushes the serialised order
 * when it builds `tx.inputs[n].tokenCategory`:
 *
 *     const extendedCategory = flattenBinArray([
 *       token.category.slice().reverse(),
 *       Uint8Array.from(capabilityByte),
 *     ]);
 *
 * So a covenant constant compared against `tokenCategory` must be reversed,
 * while everything on the JavaScript side of cashscript — `Utxo.token.category`,
 * the outputs built in `payroll-transaction.ts`, the fields written to
 * `deployment.json` — stays in display order. This function is the single
 * place the two meet: display order in, VM order out.
 *
 * Skipping it is invisible to a test whose fixture category is a byte
 * palindrome (`'e1'.repeat(32)` reverses to itself) and fatal on a real chain,
 * where the category is a real txid: `paySalary`'s "input 1 must be a mutable
 * Employment NFT of this company" check can then never pass, so the treasury
 * is permanently unspendable. `tests/support/esahod.ts` therefore uses
 * deliberately non-palindromic fixture categories.
 */
function toVmCategoryOrder(displayOrder: Uint8Array): Uint8Array {
  if (displayOrder.length !== 32) {
    throw new Error(`deployEsahod: a token category must be 32 bytes, got ${displayOrder.length}`);
  }
  return displayOrder.slice().reverse();
}

/**
 * Deploy both eSahod contracts, treasury first.
 *
 * Deployment order is not a convenience — it is required. `EmploymentVault`'s
 * constructor takes `treasuryLock`, the treasury's own 35-byte P2SH32 locking
 * bytecode, so the treasury must exist (as an address, not necessarily
 * funded) before the vault can be instantiated. There is no way to do this
 * the other way round: the treasury's constructor has no `vaultLock`
 * parameter at all — see the covenant's own "THE TRUST ROOT" comment for why
 * that is a deliberate, not accidental, omission.
 */
export function deployEsahod(
  provider: NetworkProvider,
  treasuryParams: PayrollTreasuryParams,
  hrPkh: Uint8Array,
  artifacts: { treasury?: PayrollTreasuryArtifact; vault?: EmploymentVaultArtifact } = {},
): EsahodDeployment {
  const treasury = new Contract<PayrollTreasuryArtifact>(
    artifacts.treasury ?? loadPayrollTreasuryArtifact(),
    [
      toVmCategoryOrder(treasuryParams.employmentCategory),
      toVmCategoryOrder(treasuryParams.pesoCategory),
      treasuryParams.remitConfigHash,
      treasuryParams.genesisTime,
      treasuryParams.periodSeconds,
      treasuryParams.periodsPerMonth,
      treasuryParams.payrollOfficerPkh,
      treasuryParams.lapseTime,
    ],
    { provider },
  );

  const treasuryLock = hexToBin(treasury.lockingBytecode);
  if (treasuryLock.length !== 35) {
    throw new Error(
      `deployEsahod: expected the treasury's P2SH32 locking bytecode to be 35 bytes, got ${treasuryLock.length}`,
    );
  }

  const vault = new Contract<EmploymentVaultArtifact>(
    artifacts.vault ?? loadEmploymentVaultArtifact(),
    [treasuryLock, hrPkh],
    { provider },
  );

  return { treasury, vault };
}
