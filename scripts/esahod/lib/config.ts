import { encodePrivateKeyWif, hexToBin } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ElectrumNetworkProvider, Network, SignatureTemplate, utils, type NetworkProvider, type Utxo } from 'cashscript';

/**
 * Shared plumbing for the eSahod chipnet scripts.
 *
 * These have now been run against chipnet. 01-deploy, 02-enrol-employees and
 * 03-run-payroll each broadcast successfully, and keeper-relay.ts serves the
 * app's write path on top of the same plumbing. Everything upstream of this
 * folder — the statutory engine, the codec, both covenants, the transaction
 * builder — is additionally proven against the real BCH VM via
 * `MockNetworkProvider`.
 *
 * What is still unexercised: 05-publish-bcmr, and `sweepLapsedNca`, whose
 * lapse time is years away and which no test can reach on a live chain.
 */

export const DEPLOYMENT_FILE = resolve(import.meta.dirname, '..', 'deployment.json');

export interface DeploymentRecord {
  readonly employmentCategory?: string;
  readonly pesoCategory?: string;
  readonly remitConfigHash?: string;
  readonly genesisTime?: string;
  readonly periodSeconds?: string;
  readonly lapseTime?: string;
  readonly treasuryAddress?: string;
  readonly vaultAddress?: string;
  /** Hex-encoded — needed by scripts that build outputs by raw locking bytecode. */
  readonly vaultLockingBytecode?: string;
  /**
   * Both contracts are addressed by hashing their constructor arguments, so
   * anything that needs to REBUILD them — the daemon, 03-run-payroll — needs
   * every argument, not just the resulting address. These two were the ones
   * missing, which meant a rebuilt contract hashed to a different address than
   * the deployed one and every spend failed for no visible reason.
   */
  readonly payrollOfficerPkh?: string;
  readonly hrPkh?: string;
}

export async function readDeployment(): Promise<DeploymentRecord> {
  try {
    return JSON.parse(await readFile(DEPLOYMENT_FILE, 'utf8')) as DeploymentRecord;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writeDeployment(patch: DeploymentRecord): Promise<void> {
  const merged = { ...(await readDeployment()), ...patch };

  await mkdir(dirname(DEPLOYMENT_FILE), { recursive: true });
  await writeFile(DEPLOYMENT_FILE, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(
      `${name} is not set. Generate keys with "npm run esahod:keys" and export the printed WIFs before running this script.`,
    );
  }
  return value.trim();
}

export function chipnetProvider(): NetworkProvider {
  return new ElectrumNetworkProvider(Network.CHIPNET);
}

export function keyFromWif(wif: string): SignatureTemplate {
  return new SignatureTemplate(wif);
}

export function pkhOf(signer: SignatureTemplate): Uint8Array {
  return utils.hash160(signer.getPublicKey());
}

/**
 * Chipnet has no WIF type of its own — it shares testnet's version byte
 * (0xef), so a chipnet key is WIF-encoded exactly like a testnet3 one.
 */
export function generateWif(): { wif: string; pkh: Uint8Array } {
  const privateKey = randomBytes(32);
  const key = new SignatureTemplate(privateKey);

  return { wif: encodePrivateKeyWif(privateKey, 'testnet'), pkh: pkhOf(key) };
}

/**
 * Pick fee coins that can actually cover the transaction.
 *
 * A payroll transaction funds dust on five token outputs (546 sats each) plus
 * the mining fee, and the covenant forbids either of its own inputs from
 * contributing — the treasury and the NFT must each keep their satoshis. So all
 * of it comes from here, and roughly 4,400 sats is the floor.
 *
 * Taking `feeUtxos[0]` — which every script here used to do — works right up
 * until the wallet's first coin is a small one, and then fails with an
 * arithmetic message about a negative surplus that names nothing an operator
 * can act on. Largest-first until the target is met, so a wallet holding enough
 * in total always succeeds, and one that genuinely cannot is told so plainly.
 *
 * Largest-first rather than exact-fit: it keeps the input count down, which
 * keeps the transaction smaller and the fee lower.
 */
export function selectFeeUtxos(
  utxos: readonly Utxo[],
  targetSatoshis = 15_000n,
): readonly Utxo[] {
  const spendable = utxos
    .filter((utxo) => utxo.token === undefined)
    .toSorted((a, b) => (b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0));

  const chosen: Utxo[] = [];
  let total = 0n;

  for (const utxo of spendable) {
    if (total >= targetSatoshis) break;
    chosen.push(utxo);
    total += utxo.satoshis;
  }

  if (chosen.length === 0) {
    throw new Error('the keeper holds no spendable BCH — every coin carries a token, or the wallet is empty');
  }

  if (total < 5_000n) {
    throw new Error(
      `the keeper holds only ${total} satoshis across ${chosen.length} coin(s); a payroll transaction needs roughly 4,400 for output dust plus the fee. Top it up at https://tbch.googol.cash (CHIPNET).`,
    );
  }

  return chosen;
}

export function readArg(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function toBytes20(hex: string): Uint8Array {
  const bytes = hexToBin(hex);
  if (bytes.length !== 20) throw new Error(`expected a 20-byte hex value, got ${bytes.length} bytes: ${hex}`);
  return bytes;
}

export function deploymentDir(): string {
  return dirname(DEPLOYMENT_FILE);
}
