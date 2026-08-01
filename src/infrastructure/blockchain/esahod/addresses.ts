import { hexToBin } from '@bitauth/libauth';
import { Contract, type NetworkProvider } from 'cashscript';
import { loadEmploymentVaultArtifact, type EmploymentVaultArtifact } from './employment-vault-artifact.js';
import { loadPayrollTreasuryArtifact, type PayrollTreasuryArtifact } from './payroll-treasury-artifact.js';

export type PayrollTreasuryContract = Contract<PayrollTreasuryArtifact>;
export type EmploymentVaultContract = Contract<EmploymentVaultArtifact>;

export interface PayrollTreasuryParams {
  readonly employmentCategory: Uint8Array;
  readonly pesoCategory: Uint8Array;
  readonly remitConfigHash: Uint8Array;
  readonly genesisTime: bigint;
  readonly periodSeconds: bigint;
  readonly payrollOfficerPkh: Uint8Array;
  readonly lapseTime: bigint;
}

export interface EsahodDeployment {
  readonly treasury: PayrollTreasuryContract;
  readonly vault: EmploymentVaultContract;
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
      treasuryParams.employmentCategory,
      treasuryParams.pesoCategory,
      treasuryParams.remitConfigHash,
      treasuryParams.genesisTime,
      treasuryParams.periodSeconds,
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
