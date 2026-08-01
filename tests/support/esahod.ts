import { binToHex } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, randomUtxo, utils, type Utxo } from 'cashscript';
import {
  FIXTURE_ANALYST,
  type FixtureEmployee,
  commitmentForEmployee,
  commitmentToHex,
  encodeCommitment,
} from '../../src/domain/index.js';
import { deployEsahod, type EsahodDeployment } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { buildPaySalaryTransaction } from '../../src/infrastructure/blockchain/esahod/payroll-transaction.js';

/**
 * Shared fixtures for every eSahod covenant test — the VM proof
 * (`pay-salary.test.ts`) and the attack suite (`attacks.test.ts`) build
 * against the exact same deployment and funding helpers, so a change to how a
 * scenario is funded can never make one suite pass while silently breaking
 * what the other actually proves.
 */

/**
 * These two are deliberately NOT of the `'e1'.repeat(32)` shape.
 *
 * A category is a genesis txid, and the BCH VM sees it in the reverse of the
 * byte order everything on the JavaScript side uses (see `toVmCategoryOrder`
 * in `addresses.ts`). A category whose every byte is identical reverses to
 * itself, so it makes the whole suite blind to that reversal being dropped —
 * a bug that passes 315 tests and then makes the treasury permanently
 * unspendable the first time it meets a real chain. Keep these asymmetric.
 */
export const EMPLOYMENT_CATEGORY = '9d1f7a3c04b8e25610fd93ac7b41e8025f6c3d9018be74a2c5031f8d6e2b4a70';
export const PESO_CATEGORY = '31c8b60f9a24d75e08163bf4ce9207da5b8e41306c7fa9d2185e30bc47f6a9e1';
export const PERIOD_SECONDS = 1_314_873n;
const NOW = BigInt(Math.floor(Date.now() / 1000));
// The demo trick from the architecture doc: periods 0-4 are already
// claimable, period 5 is genuinely ~15 days out.
export const GENESIS_TIME = NOW - 5n * PERIOD_SECONDS;
export const LAPSE_TIME = NOW + 365n * 86_400n;

export const officer = new SignatureTemplate(Uint8Array.from({ length: 32 }, (_, i) => i + 1));
export const hr = new SignatureTemplate(Uint8Array.from({ length: 32 }, (_, i) => i + 51));
export const feePayer = new SignatureTemplate(Uint8Array.from({ length: 32 }, (_, i) => i + 101));
export const feePayerLockingBytecode = feePayer.unlockP2PKH().generateLockingBytecode();

export const sssPkh = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
export const phicPkh = Uint8Array.from({ length: 20 }, (_, i) => i + 21);
export const hdmfPkh = Uint8Array.from({ length: 20 }, (_, i) => i + 41);
export const birPkh = Uint8Array.from({ length: 20 }, (_, i) => i + 61);
export const remitConfigHash = utils.hash160(Uint8Array.from([...sssPkh, ...phicPkh, ...hdmfPkh, ...birPkh]));

export const employeePayeePkh = Uint8Array.from({ length: 20 }, (_, i) => i + 200);
export const attackerPkh = Uint8Array.from({ length: 20 }, (_, i) => 250 - i);

export function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

export function deploy(provider: MockNetworkProvider): EsahodDeployment {
  return deployEsahod(
    provider,
    {
      employmentCategory: hexToBytes(EMPLOYMENT_CATEGORY),
      pesoCategory: hexToBytes(PESO_CATEGORY),
      remitConfigHash,
      genesisTime: GENESIS_TIME,
      periodSeconds: PERIOD_SECONDS,
      payrollOfficerPkh: utils.hash160(officer.getPublicKey()),
      lapseTime: LAPSE_TIME,
    },
    utils.hash160(hr.getPublicKey()),
  );
}

export interface Scenario {
  readonly provider: MockNetworkProvider;
  readonly deployment: EsahodDeployment;
  readonly treasuryUtxo: Utxo;
  readonly nftUtxo: Utxo;
  readonly feeUtxo: Utxo;
}

export interface FundScenarioOptions {
  readonly treasuryEphp?: bigint;
  readonly nextPeriod?: number;
  readonly endPeriod?: number;
  readonly status?: 0 | 1;
  /** Override the NFT's token category — used by the wrong-category attack. */
  readonly nftCategory?: string;
}

export function fundScenario(fixture: FixtureEmployee = FIXTURE_ANALYST, options: FundScenarioOptions = {}): Scenario {
  const provider = new MockNetworkProvider();
  const deployment = deploy(provider);

  const treasuryUtxo = randomUtxo({
    satoshis: 5_000_000n,
    token: { amount: options.treasuryEphp ?? 500_000_000n, category: PESO_CATEGORY },
  });
  provider.addUtxo(deployment.treasury.address, treasuryUtxo);

  const commitment = commitmentForEmployee(fixture, {
    payeePkh: employeePayeePkh,
    nextPeriod: options.nextPeriod ?? 0,
    endPeriod: options.endPeriod ?? 23,
    ...(options.status === undefined ? {} : { status: options.status }),
  });
  const nftUtxo = randomUtxo({
    satoshis: 1_000n,
    token: {
      amount: 0n,
      category: options.nftCategory ?? EMPLOYMENT_CATEGORY,
      nft: { capability: 'mutable', commitment: commitmentToHex(encodeCommitment(commitment)) },
    },
  });
  provider.addUtxo(deployment.vault.address, nftUtxo);

  const feeUtxo = randomUtxo({ satoshis: 50_000n });
  provider.addUtxo(binToHex(feePayerLockingBytecode), feeUtxo);

  return { provider, deployment, treasuryUtxo, nftUtxo, feeUtxo };
}

export function buildTx(scenario: Scenario) {
  return buildPaySalaryTransaction({
    provider: scenario.provider,
    treasury: scenario.deployment.treasury,
    vault: scenario.deployment.vault,
    treasuryUtxo: scenario.treasuryUtxo,
    nftUtxo: scenario.nftUtxo,
    feeUtxos: [scenario.feeUtxo],
    feeSigner: feePayer,
    feeChangeAddress: feePayerLockingBytecode,
    remitConfig: { sssPkh, phicPkh, hdmfPkh, birPkh },
    genesisTime: GENESIS_TIME,
    periodSeconds: PERIOD_SECONDS,
  });
}
