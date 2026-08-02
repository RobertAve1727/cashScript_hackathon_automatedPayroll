/**
 * Compiles every `contracts/*.cash` source into `artifacts/<name>.json`.
 *
 * Artifacts are committed build output: the runtime loads them, so a deployment
 * never needs the compiler and the deployed bytecode is reviewable in git.
 *
 * The size report is not decoration. A contract's redeem script is pushed onto
 * the stack by the spending transaction, and stack items were capped at 520
 * bytes until the May 2025 VM-limits upgrade raised the cap to 10,000. Anything
 * above 520 still works on today's network but stops being conservative, so the
 * number is printed on every build and flagged when it crosses the line.
 */
import { compileFile } from 'cashc';
import { utils } from 'cashscript';
import { mkdir, writeFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const CONTRACTS_DIR = resolve(import.meta.dirname, '..', 'contracts');
const ARTIFACTS_DIR = resolve(import.meta.dirname, '..', 'artifacts');

/** Historic maximum size of a single stack item, and so of a P2SH redeem script. */
const CONSERVATIVE_SCRIPT_LIMIT = 520;

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

    const script = utils.asmToScript(artifact.bytecode);
    const bytes = utils.calculateBytesize(script);
    const opcodes = utils.countOpcodes(script);
    const warning = bytes > CONSERVATIVE_SCRIPT_LIMIT ? '  ⚠ above the historic 520-byte push limit' : '';

    console.log(
      `compiled ${source} -> artifacts/${basename(target)}` +
        ` (${bytes} bytes, ${opcodes} opcodes)${warning}`,
    );
  }
}

await main();
