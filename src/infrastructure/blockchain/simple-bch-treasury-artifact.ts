import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Artifact } from 'cashscript';

/**
 * The compiled shape of `contracts/simple_bch_treasury.cash`, stated as literal
 * types.
 *
 * This is the LEGACY generic plain-BCH treasury that drives the original CLI
 * demo — NOT the eSahod statutory covenant (`payroll_treasury.cash` /
 * `artifacts/payroll_treasury.json`), which has a different ABI and needs a
 * token-aware transaction builder.
 *
 * CashScript infers unlocker signatures from the artifact's type, so declaring
 * the ABI this precisely is what turns `contract.unlock.disburse(sig)` into a
 * checked call instead of `any`. If the `.cash` source changes, this type stops
 * matching the artifact and the mismatch surfaces at compile time rather than
 * as a failed broadcast.
 */
export type SimpleBchTreasuryArtifact = Artifact & {
  constructorInputs: [
    { name: 'operatorPk'; type: 'pubkey' },
    { name: 'treasurerPkh'; type: 'bytes20' },
    { name: 'payoutInterval'; type: 'int' },
  ];
  abi: [
    { name: 'disburse'; inputs: [{ name: 'operatorSig'; type: 'sig' }] },
    {
      name: 'reclaim';
      inputs: [{ name: 'treasurerPk'; type: 'pubkey' }, { name: 'treasurerSig'; type: 'sig' }];
    },
  ];
};

export class ContractArtifactMissingError extends Error {
  readonly code = 'INFRA.CONTRACT_ARTIFACT_MISSING';

  constructor(path: string) {
    super(`no compiled contract artifact at ${path} — run "npm run contracts:compile"`);
    this.name = 'ContractArtifactMissingError';
  }
}

/** `<packageRoot>/artifacts`, whether running from `src` (tsx) or `dist`. */
export function defaultArtifactDirectory(): string {
  return resolve(import.meta.dirname, '..', '..', '..', 'artifacts');
}

export function loadSimpleBchTreasuryArtifact(directory = defaultArtifactDirectory()): SimpleBchTreasuryArtifact {
  const path = join(directory, 'simple_bch_treasury.json');

  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SimpleBchTreasuryArtifact;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
      throw new ContractArtifactMissingError(path);
    }
    throw error;
  }
}
