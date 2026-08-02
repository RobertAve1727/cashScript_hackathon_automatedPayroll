#!/usr/bin/env node
/**
 * Turn `bcmr/registry.json` (a template full of placeholders) into the exact
 * bytes you will host, then print the two things you need to publish it: the
 * SHA-256 of those bytes, and the OP_RETURN locking bytecode that commits to
 * them.
 *
 * This script BROADCASTS NOTHING. It reads, substitutes, hashes and prints.
 * Publishing is a transaction you build and send yourself, because it has to
 * spend a very specific coin - the identity output at the head of each
 * category's authchain - and getting that wrong silently publishes metadata
 * nobody will ever resolve. See `bcmr/README.md`.
 *
 * Run (after 01-deploy.ts has written scripts/esahod/deployment.json):
 *   npx tsx scripts/esahod/05-publish-bcmr.ts --host payroll.example.ph
 *
 * Flags:
 *   --host <domain>   replace the `esahod.example` placeholder in every URI
 *   --uri <uri>       URI to push in the OP_RETURN (repeatable; defaults to
 *                     the well-known URI of --host)
 *   --in <path>       template to read   (default bcmr/registry.json)
 *   --out <path>      bytes to serve     (default bcmr/registry.published.json)
 */
import { binToHex, hexToBin, utf8ToBin } from '@bitauth/libauth';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { readArg, readDeployment } from './lib/config.js';

const REPO_ROOT = resolve(import.meta.dirname, '..', '..');
const DEFAULT_TEMPLATE = resolve(REPO_ROOT, 'bcmr', 'registry.json');
const DEFAULT_OUTPUT = resolve(REPO_ROOT, 'bcmr', 'registry.published.json');

/** The three strings the template is seeded with; see bcmr/README.md section 3. */
const PESO_PLACEHOLDER = 'REPLACE_WITH_PESO_CATEGORY_FROM_DEPLOYMENT_JSON';
const EMPLOYMENT_PLACEHOLDER = 'REPLACE_WITH_EMPLOYMENT_CATEGORY_FROM_DEPLOYMENT_JSON';
const HOST_PLACEHOLDER = 'esahod.example';

const WELL_KNOWN_PATH = '/.well-known/bitcoin-cash-metadata-registry.json';
/** OP_RETURN <'BCMR'> - the locking bytecode prefix every BCMR publication output starts with. */
const BCMR_PREFIX = hexToBin('6a0442434d52');

const CATEGORY_PATTERN = /^[0-9a-f]{64}$/;

interface EncodedUri {
  /** The utf8 bytes actually pushed. */
  readonly pushed: string;
  /** What a spec-compliant client will download. */
  readonly resolvesTo: string;
}

/** Repo-relative when the path is inside the repo, absolute when it is not. */
function display(path: string): string {
  const relativePath = relative(REPO_ROOT, path);
  return relativePath.startsWith('..') ? path : relativePath;
}

function readFlagAll(argv: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`${flag} needs a value`);
    values.push(value);
  }
  return values;
}

/**
 * The spec's canonical short form: a URI with no protocol is assumed HTTPS,
 * and an HTTPS URI with no path is assumed to mean that domain's well-known
 * URI. Paytaca's indexer implements both rules (`decode_url` prepends
 * `https://` to anything containing a dot; `process_op_return` appends the
 * well-known path when `urlparse(...).path == ''`).
 */
function canonicaliseUri(raw: string): EncodedUri {
  const trimmed = raw.trim();
  if (trimmed.startsWith('ipfs://')) return { pushed: trimmed, resolvesTo: trimmed };

  const withoutScheme = trimmed.replace(/^https:\/\//i, '');
  if (withoutScheme.endsWith(WELL_KNOWN_PATH)) {
    const host = withoutScheme.slice(0, -WELL_KNOWN_PATH.length);
    return { pushed: host, resolvesTo: `https://${host}${WELL_KNOWN_PATH}` };
  }
  const hasPath = withoutScheme.includes('/');
  return {
    pushed: withoutScheme,
    resolvesTo: `https://${withoutScheme}${hasPath ? '' : WELL_KNOWN_PATH}`,
  };
}

/** Minimal-length data push, matching how CashScript encodes OP_RETURN chunks. */
function pushData(data: Uint8Array): Uint8Array {
  const length = data.length;
  if (length === 0) return Uint8Array.of(0x00); // OP_0
  if (length <= 75) return Uint8Array.from([length, ...data]);
  if (length <= 0xff) return Uint8Array.from([0x4c, length, ...data]); // OP_PUSHDATA1
  if (length <= 0xffff) return Uint8Array.from([0x4d, length & 0xff, length >> 8, ...data]); // OP_PUSHDATA2
  throw new Error(`cannot push ${length} bytes into an OP_RETURN`);
}

function requireCategory(value: string | undefined, name: string): string {
  if (value === undefined) {
    throw new Error(`deployment.json has no ${name} - run scripts/esahod/01-deploy.ts first`);
  }
  if (!CATEGORY_PATTERN.test(value)) {
    throw new Error(`deployment.json's ${name} is not a 32-byte lowercase hex category id: ${value}`);
  }
  return value;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const templatePath = resolve(REPO_ROOT, readArg(argv, '--in') ?? DEFAULT_TEMPLATE);
  const outputPath = resolve(REPO_ROOT, readArg(argv, '--out') ?? DEFAULT_OUTPUT);
  const host = readArg(argv, '--host');

  const deployment = await readDeployment();
  const pesoCategory = requireCategory(deployment.pesoCategory, 'pesoCategory');
  const employmentCategory = requireCategory(deployment.employmentCategory, 'employmentCategory');

  const template = await readFile(templatePath, 'utf8');
  for (const [placeholder, label] of [
    [PESO_PLACEHOLDER, 'ePHP'],
    [EMPLOYMENT_PLACEHOLDER, 'employment'],
  ] as const) {
    if (!template.includes(placeholder)) {
      throw new Error(
        `${display(templatePath)} contains no ${label} placeholder (${placeholder}) - ` +
          'is this the template, or an already-substituted copy?',
      );
    }
  }

  let registry = template
    .replaceAll(PESO_PLACEHOLDER, pesoCategory)
    .replaceAll(EMPLOYMENT_PLACEHOLDER, employmentCategory);
  if (host !== undefined) registry = registry.replaceAll(HOST_PLACEHOLDER, host);

  if (registry.includes('REPLACE_WITH_')) {
    throw new Error('a REPLACE_WITH_ placeholder survived substitution - refusing to hash a half-filled registry');
  }

  // Re-parse to prove the substitution left valid JSON pointing at the right categories.
  const parsed = JSON.parse(registry) as { identities?: Record<string, unknown> };
  for (const category of [pesoCategory, employmentCategory]) {
    if (parsed.identities?.[category] === undefined) {
      throw new Error(`the substituted registry has no identity keyed by ${category}`);
    }
  }

  const bytes = utf8ToBin(registry);
  const nonAscii = bytes.filter((byte) => byte > 0x7f).length;
  await writeFile(outputPath, registry, 'utf8');

  const hash = createHash('sha256').update(bytes).digest();
  const hashHex = hash.toString('hex');

  const uriArgs = readFlagAll(argv, '--uri');
  const uris = (uriArgs.length > 0 ? uriArgs : host === undefined ? [] : [host]).map(canonicaliseUri);
  if (uris.length === 0) {
    throw new Error('pass --host <domain> (or at least one --uri) so the OP_RETURN can say where to download the registry');
  }

  const lockingBytecode = Uint8Array.from([
    ...BCMR_PREFIX,
    ...pushData(Uint8Array.from(hash)),
    ...uris.flatMap((uri) => [...pushData(utf8ToBin(uri.pushed))]),
  ]);

  console.log(`template:  ${display(templatePath)}`);
  console.log(`published: ${display(outputPath)}  (${bytes.length} bytes)`);
  console.log(`  ePHP category:       ${pesoCategory}`);
  console.log(`  employment category: ${employmentCategory}`);
  if (host === undefined) console.log(`  WARNING: no --host given, so "${HOST_PLACEHOLDER}" URIs are still in the file`);
  if (nonAscii > 0) {
    console.log(
      `  WARNING: ${nonAscii} non-ASCII byte(s). Paytaca's indexer hashes response.text, i.e. the file after a ` +
        'decode/re-encode round trip - serve it as application/json; charset=utf-8 or the hash will not match.',
    );
  }

  console.log('\nsha256 of those exact bytes (OP_SHA256 byte order, no reversal):');
  console.log(`  ${hashHex}`);

  console.log('\nOP_RETURN publication output:');
  console.log(`  lockingBytecode: ${binToHex(lockingBytecode)}`);
  console.log(`  size:            ${lockingBytecode.length} bytes (relay limit is 223)`);
  console.log("  pushes:          OP_RETURN <'BCMR'> <hash>" + uris.map(() => ' <uri>').join(''));
  for (const uri of uris) {
    console.log(`    uri "${uri.pushed}" (${utf8ToBin(uri.pushed).length} bytes) -> ${uri.resolvesTo}`);
  }

  console.log('\nCashScript equivalent, for the transaction you build yourself:');
  console.log(`  builder.addOpReturnOutput(['BCMR', '0x${hashHex}', ${uris.map((u) => `'${u.pushed}'`).join(', ')}]);`);

  console.log('\nNEXT - this output has to land in the authhead of BOTH authchains, one transaction each:');
  for (const [label, category] of [
    ['ePHP', pesoCategory],
    ['employment', employmentCategory],
  ] as const) {
    console.log(`  ${label}:`);
    console.log(`    curl -s https://bcmr-chipnet.paytaca.com/api/authchain/${category}/head/`);
  }
  console.log('\nEach transaction must spend output 0 of that category\'s current authhead, put a fresh');
  console.log('spendable output 0 back (that is the new identity output), and carry the OP_RETURN above.');
  console.log('Nothing has been broadcast. See bcmr/README.md.');
}

await main();
