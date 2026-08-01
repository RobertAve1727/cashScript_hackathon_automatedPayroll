/**
 * Compiles every `contracts/*.cash` source into `artifacts/<name>.json`.
 *
 * Artifacts are committed build output: the runtime loads them, so a deployment
 * never needs the compiler and the deployed bytecode is reviewable in git.
 */
import { compileFile } from 'cashc';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const CONTRACTS_DIR = resolve(import.meta.dirname, '..', 'contracts');
const ARTIFACTS_DIR = resolve(import.meta.dirname, '..', 'artifacts');

async function main(): Promise<void> {
  const sources = readdirSync(CONTRACTS_DIR).filter((file) => file.endsWith('.cash'));

  if (sources.length === 0) {
    throw new Error(`no .cash sources found in ${CONTRACTS_DIR}`);
  }

  await mkdir(ARTIFACTS_DIR, { recursive: true });

  for (const source of sources) {
    const artifact = compileFile(join(CONTRACTS_DIR, source));
    const target = join(ARTIFACTS_DIR, `${basename(source, '.cash')}.json`);

    await writeFile(target, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(`compiled ${source} -> artifacts/${basename(target)} (${artifact.bytecode.length / 2} bytes)`);
  }
}

await main();
