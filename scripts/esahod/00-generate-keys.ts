#!/usr/bin/env node
/**
 * Generate the three eSahod keys and print their WIFs, hash160es and the
 * environment variables the rest of the scripts read.
 *
 * Three keys, three homes — do not conflate them:
 *   keeper  — hot, in Node, pays every transaction fee. Never goes near Paytaca.
 *   hr      — signs amend() and holds the employment minting NFT briefly at
 *             genesis, before it is burned. Import this WIF into Paytaca so
 *             the WalletConnect signing flow has something real to sign.
 *   officer — signs sweepLapsedNca only. Cold-ish; used once a year.
 *
 * Run: npx tsx scripts/esahod/00-generate-keys.ts
 * Then fund the keeper's address from https://tbch.googol.cash (pick
 * CHIPNET) before running 01-deploy.ts.
 */
import { encodeCashAddress } from '@bitauth/libauth';
import { generateWif, pkhOf, keyFromWif, readDeployment } from './lib/config.js';

/**
 * This script prints and nothing else — it writes no file and touches no chain,
 * so running it is always safe. The danger is entirely in what an operator does
 * with the output, and it is worth spelling out before the keys scroll past.
 *
 * Both covenants are addressed by hashing their constructor arguments.
 * `payrollOfficerPkh` is one of the treasury's, and the vault takes the
 * treasury's lock plus `hrPkh` — so replacing either of those keys moves BOTH
 * contracts to addresses that have never held anything.
 *
 * The coins do not move and are not lost; the tooling simply stops pointing at
 * them. What IS unrecoverable is the HR key itself: `amend()` needs the private
 * key, not the hash, so an employment record whose HR WIF is gone can never be
 * amended again. paySalary survives — it needs no signature at all.
 */
async function warnIfDeployed(): Promise<void> {
  const deployment = await readDeployment();
  if (deployment.treasuryAddress === undefined) return;

  console.log(`
  ┌─ THERE IS ALREADY A DEPLOYMENT ────────────────────────────────────────
  │
  │  treasury  ${deployment.treasuryAddress}
  │
  │  Nothing below is in use yet, and nothing has changed — this script only
  │  prints. But if you put these keys in scripts/esahod/.env:
  │
  │    ESAHOD_OFFICER_WIF  changes BOTH contract addresses (it is a treasury
  │                        constructor argument, and the vault takes the
  │                        treasury's lock). The tooling would point at empty
  │                        contracts. Existing funds stay where they are.
  │
  │    ESAHOD_HR_WIF       changes the vault address, and losing the old WIF
  │                        makes amend() impossible on existing records
  │                        FOREVER. Payroll still works — it needs no key.
  │
  │    ESAHOD_KEEPER_WIF   safe to rotate. It only pays fees. The new address
  │                        starts at zero, so claim from the faucet again.
  │
  │  Rotating the keeper alone is the common case and is fine. Generate a full
  │  fresh set only when starting a NEW deployment from 01-deploy.ts.
  │
  └────────────────────────────────────────────────────────────────────────`);
}

await warnIfDeployed();

/**
 * Chipnet shares testnet's cashaddr prefix, `bchtest` — it has no prefix of
 * its own, the same way it has no WIF version byte of its own.
 */
function addressOf(pkh: Uint8Array): string {
  return encodeCashAddress({ payload: pkh, prefix: 'bchtest', type: 'p2pkh' }).address;
}

function printKey(label: string, envVar: string): void {
  const { wif, pkh } = generateWif();
  const pkhHex = Buffer.from(pkh).toString('hex');

  console.log(`\n${label}`);
  console.log(`  export ${envVar}=${wif}`);
  console.log(`  address: ${addressOf(pkh)}`);
  console.log(`  hash160: ${pkhHex}`);

  // Round-trip through SignatureTemplate to prove the WIF decodes back to
  // the same key before the operator copies it anywhere.
  const roundTripped = pkhOf(keyFromWif(wif));
  if (Buffer.from(roundTripped).toString('hex') !== pkhHex) {
    throw new Error(`${label}: WIF round-trip mismatch — do not use this key`);
  }
}

console.log('eSahod chipnet keys — copy the export lines into your shell before running the other scripts.');
printKey('Keeper (fee payer — needs faucet funding)', 'ESAHOD_KEEPER_WIF');
printKey('HR (amend + genesis minting)', 'ESAHOD_HR_WIF');
printKey('Payroll officer (sweepLapsedNca only)', 'ESAHOD_OFFICER_WIF');
console.log(`
Next: fund the KEEPER address at https://tbch.googol.cash (select CHIPNET).

Claim TWICE, as two separate faucet requests. 01-deploy needs two distinct
funding coins that each sit at OUTPUT INDEX 0, because a CashTokens category
id is the txid of a vout-0 outpoint — a coin at vout 1 mints a category that
nothing on chain will ever match. One claim split in two will not do: the
split leaves one of the halves at vout 1.

Then: npx tsx scripts/esahod/01-deploy.ts`);
