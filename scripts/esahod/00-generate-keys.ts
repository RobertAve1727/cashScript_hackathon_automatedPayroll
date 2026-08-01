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
import { encodeCashAddress } from '@bitauth/libauth';
import { generateWif, pkhOf, keyFromWif } from './lib/config.js';

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
Next: fund the KEEPER address at https://tbch4.googol.cash/ (select CHIPNET).

Claim TWICE, as two separate faucet requests. 01-deploy needs two distinct
funding coins that each sit at OUTPUT INDEX 0, because a CashTokens category
id is the txid of a vout-0 outpoint — a coin at vout 1 mints a category that
nothing on chain will ever match. One claim split in two will not do: the
split leaves one of the halves at vout 1.

Then: npx tsx scripts/esahod/01-deploy.ts`);
