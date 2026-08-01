import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from 'cashscript';
import { ContractArtifactMissingError, defaultArtifactDirectory } from '../simple-bch-treasury-artifact.js';

/**
 * The compiled shape of `contracts/employment_vault.cash`. See
 * `payroll-treasury-artifact.ts` for why the ABI is declared this precisely.
 */
export type EmploymentVaultArtifact = Artifact & {
  constructorInputs: [{ name: 'treasuryLock'; type: 'bytes35' }, { name: 'hrPkh'; type: 'bytes20' }];
  abi: [
    { name: 'payroll'; inputs: [] },
    { name: 'amend'; inputs: [{ name: 'hrSig'; type: 'sig' }, { name: 'hrPk'; type: 'pubkey' }] },
  ];
};

export function loadEmploymentVaultArtifact(directory = defaultArtifactDirectory()): EmploymentVaultArtifact {
  const path = join(directory, 'employment_vault.json');

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as EmploymentVaultArtifact;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new ContractArtifactMissingError(path);
    }
    throw error;
  }
}
