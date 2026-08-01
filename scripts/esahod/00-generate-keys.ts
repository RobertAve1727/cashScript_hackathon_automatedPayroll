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
 * Then fund the keeper's address from https://tbch4.googol.cash/ (pick
 * CHIPNET) before running 01-deploy.ts.
 */
import { generateWif, pkhOf, keyFromWif } from './lib/config.js';

function printKey(label: string, envVar: string): void {
  const { wif, pkh } = generateWif();
  const pkhHex = Buffer.from(pkh).toString('hex');

  console.log(`\n${label}`);
  console.log(`  export ${envVar}=${wif}`);
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
console.log('\nFund the Keeper address at https://tbch4.googol.cash/ (select CHIPNET), then run 01-deploy.ts.');
