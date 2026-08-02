import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Artifact } from 'cashscript';
import { ContractArtifactMissingError, defaultArtifactDirectory } from '../simple-bch-treasury-artifact.js';

/**
 * The compiled shape of `contracts/payroll_treasury.cash` — the eSahod
 * statutory covenant, not the legacy generic-BCH contract.
 *
 * CashScript infers unlocker signatures from the artifact's type, so
 * declaring the ABI this precisely turns `contract.unlock.paySalary(...)`
 * into a checked call instead of `any`. If the `.cash` source changes, this
 * type stops matching the artifact and the mismatch surfaces at compile
 * time rather than as a failed broadcast.
 */
export type PayrollTreasuryArtifact = Artifact & {
  constructorInputs: [
    { name: 'employmentCategory'; type: 'bytes32' },
    { name: 'pesoCategory'; type: 'bytes32' },
    { name: 'remitConfigHash'; type: 'bytes20' },
    { name: 'genesisTime'; type: 'int' },
    { name: 'periodSeconds'; type: 'int' },
    { name: 'payrollOfficerPkh'; type: 'bytes20' },
    { name: 'lapseTime'; type: 'int' },
  ];
  abi: [
    {
      name: 'paySalary';
      inputs: [
        { name: 'sssPkh'; type: 'bytes20' },
        { name: 'phicPkh'; type: 'bytes20' },
        { name: 'hdmfPkh'; type: 'bytes20' },
        { name: 'birPkh'; type: 'bytes20' },
      ];
    },
    {
      name: 'sweepLapsedNca';
      inputs: [{ name: 'officerSig'; type: 'sig' }, { name: 'officerPk'; type: 'pubkey' }];
    },
  ];
};

export function loadPayrollTreasuryArtifact(directory = defaultArtifactDirectory()): PayrollTreasuryArtifact {
  const path = join(directory, 'payroll_treasury.json');

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PayrollTreasuryArtifact;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new ContractArtifactMissingError(path);
    }
    throw error;
  }
}
