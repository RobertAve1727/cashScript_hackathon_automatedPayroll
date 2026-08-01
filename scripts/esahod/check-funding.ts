#!/usr/bin/env node
/**
 * Is the keeper funded, and are the coins usable by 01-deploy?
 *
 * 01-deploy needs TWO funding coins that each sit at output index 0, because
 * a CashTokens category id is the txid of a vout-0 outpoint. A coin at vout 1
 * mints a category that nothing on chain will ever match, so the script
 * refuses rather than producing a deployment that can never work.
 *
 * That is a fiddly precondition to discover from a failed deploy, so this
 * checks it directly and says which coins qualify.
 *
 * Run: ESAHOD_KEEPER_WIF=… npx tsx scripts/esahod/check-funding.ts
 */
import { encodeCashAddress } from '@bitauth/libauth';
import { chipnetProvider, keyFromWif, pkhOf, requireEnv } from './lib/config.js';

const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
const address = encodeCashAddress({ payload: pkhOf(keeper), prefix: 'bchtest', type: 'p2pkh' }).address;

console.log(`Keeper address : ${address}`);
console.log('Querying chipnet…\n');

const provider = chipnetProvider();
const utxos = await provider.getUtxos(address);

if (utxos.length === 0) {
  console.log('No coins yet.');
  console.log('Claim at https://tbch4.googol.cash (select CHIPNET), then run this again.');
  console.log('A faucet claim usually appears within a few seconds, unconfirmed.');
  process.exit(0);
}

const usable = utxos.filter((utxo) => utxo.vout === 0 && utxo.token === undefined);
const unusable = utxos.filter((utxo) => utxo.vout !== 0 || utxo.token !== undefined);

const bch = (sats: bigint): string => `${(Number(sats) / 100_000_000).toFixed(8)} BCH`;

console.log(`${utxos.length} coin(s) at this address:\n`);
for (const utxo of utxos) {
  const ok = utxo.vout === 0 && utxo.token === undefined;
  console.log(
    `  ${ok ? '✓' : '✗'} ${utxo.txid.slice(0, 16)}…:${utxo.vout}  ${bch(utxo.satoshis)}` +
      `${utxo.token ? '  (carries a token — not spendable as plain funding)' : ''}` +
      `${utxo.vout !== 0 ? '  (vout is not 0 — cannot mint a category)' : ''}`,
  );
}

console.log(`\nUsable for a category genesis: ${usable.length} of ${utxos.length}`);

if (usable.length >= 2) {
  console.log('\nReady. Run: npx tsx scripts/esahod/01-deploy.ts');
} else if (usable.length === 1) {
  console.log(
    '\nOne more needed. Claim from the faucet AGAIN to the same address — a second\n' +
      'separate claim, not a split of the coin you already have. Splitting leaves one\n' +
      'half at vout 1, which cannot mint a category.',
  );
} else {
  console.log(
    `\nNone usable.${unusable.length > 0 ? ' Every coin here is either at a non-zero vout or already carries a token.' : ''}\n` +
      'Claim fresh coins from the faucet to this address.',
  );
}
