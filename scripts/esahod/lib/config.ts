import { encodePrivateKeyWif, hexToBin } from '@bitauth/libauth';
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { ElectrumNetworkProvider, Network, SignatureTemplate, utils, type NetworkProvider } from 'cashscript';

/**
 * Shared plumbing for the eSahod chipnet scripts.
 *
 * NOT VERIFIED AGAINST A REAL CHIPNET SERVER. Everything upstream of this
 * folder (the statutory engine, the codec, both covenants, the transaction
 * builder) is proven against `MockNetworkProvider` and the real BCH VM —
 * these scripts are the untested edge of the project, honestly: nobody on
 * this build has had a funded chipnet key to run them against yet. Read them
 * for shape and correctness of the plumbing, not as a claim they have been
 * exercised end to end. `npm run typecheck` is the only thing that has
 * actually checked them.
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
