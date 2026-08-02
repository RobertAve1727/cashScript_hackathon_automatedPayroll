#!/usr/bin/env node
/**
 * Turn one faucet claim into the two vout-0 coins 01-deploy needs.
 *
 * ══ THE PROBLEM ═════════════════════════════════════════════════════════
 *
 * A CashTokens category id is the txid of a vout-0 outpoint, so minting two
 * categories needs two coins that each sit at OUTPUT INDEX 0 of their own
 * transaction. Faucets rate-limit, and a second claim to the same address is
 * often refused — which leaves an operator with one usable coin and no
 * obvious way forward.
 *
 * Splitting the coin in two does not help, and that is the trap: a split has
 * outputs 0 and 1, so it yields one usable coin and one useless one.
 *
 * ══ THE FIX ═════════════════════════════════════════════════════════════
 *
 * Two chained self-sends:
 *
 *   A: spend the coin  → out 0 = half        (usable ✓)
 *                        out 1 = change      (useless for genesis)
 *   B: spend A's out 1 → out 0 = the rest    (usable ✓)
 *
 * Two transactions, two vout-0 coins, no faucet. B is built from A's known
 * outputs rather than by re-querying, so it does not depend on how quickly
 * the Electrum server surfaces an unconfirmed coin.
 *
 * Idempotent: with two usable coins already present it does nothing.
 *
 * Run: ESAHOD_KEEPER_WIF=… npx tsx scripts/esahod/prepare-funding.ts
 */
import { encodeCashAddress } from '@bitauth/libauth';
import { chipnetProvider, keyFromWif, pkhOf, requireEnv } from './lib/config.js';

/** Enough to cover both genesis transactions' dust and fees comfortably. */
const FIRST_SPLIT_SATOSHIS = 400_000n;
/** Below this the split is not worth attempting — top up from the faucet instead. */
const MINIMUM_WORKABLE_SATOSHIS = 500_000n;

const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
const keeperAddress = encodeCashAddress({
  payload: pkhOf(keeper),
  prefix: 'bchtest',
  type: 'p2pkh',
}).address;

const provider = chipnetProvider();
const { TransactionBuilder } = await import('cashscript');

const utxos = await provider.getUtxos(keeperAddress);
const spendable = utxos.filter((utxo) => utxo.token === undefined);
/**
 * A genesis coin must sit at vout 0 AND carry enough to fund the token output
 * plus the fee. Counting only the position is how this script came to report
 * "nothing to do" while holding two 1,000-satoshi coins that 01-deploy then
 * failed on — a check that answers the easy half of the question is worse
 * than no check, because it stops you looking.
 */
const GENESIS_MINIMUM_SATS = 15_000n;

const usable = spendable.filter((utxo) => utxo.vout === 0 && utxo.satoshis >= GENESIS_MINIMUM_SATS);

console.log(`Keeper: ${keeperAddress}`);
console.log(`  ${spendable.length} spendable coin(s), ${usable.length} at vout 0\n`);

if (usable.length >= 2) {
  console.log(`Already have two vout-0 coins of at least ${GENESIS_MINIMUM_SATS} sats. Nothing to do.`);
  console.log('Run: npx tsx scripts/esahod/01-deploy.ts');
  process.exit(0);
}

// Largest first, and from every spendable coin rather than only the vout-0
// ones. The coin worth splitting is usually the change output of an earlier
// transaction, which by definition is not at vout 0 — taking `spendable[0]`
// picked whichever the node happened to return first, and reported a
// 1,000-satoshi dust coin as "the largest".
const source = [...spendable].sort((a, b) =>
  b.satoshis > a.satoshis ? 1 : b.satoshis < a.satoshis ? -1 : 0,
)[0];
if (!source) {
  throw new Error(
    'No spendable coins. Claim from https://tbch.googol.cash (select CHIPNET) first.',
  );
}
if (source.satoshis < MINIMUM_WORKABLE_SATOSHIS) {
  throw new Error(
    `The largest coin holds ${source.satoshis} satoshis, which is too little to split into two ` +
      `genesis inputs plus fees. Claim more from https://tbch.googol.cash (select CHIPNET).`,
  );
}

// ── A: split, leaving a usable coin at output 0 ─────────────────────────
const splitTx = new TransactionBuilder({ provider });
splitTx.addInput(source, keeper.unlockP2PKH());
splitTx.addOutput({ to: keeperAddress, amount: FIRST_SPLIT_SATOSHIS });
splitTx.addBchChangeOutputIfNeeded({ to: keeperAddress, feeRate: 1 });

if (splitTx.outputs.length < 2) {
  throw new Error('split produced no change output — the coin is too small to divide');
}
const changeAmount = splitTx.outputs[1]!.amount;

console.log('broadcasting split…');
const splitReceipt = await splitTx.send();
console.log(`  txid: ${splitReceipt.txid}`);
console.log(`  out 0: ${FIRST_SPLIT_SATOSHIS} sat  ← genesis input 1`);
console.log(`  out 1: ${changeAmount} sat  (change — not usable for genesis)\n`);

// ── B: move the change so it lands at output 0 of its own transaction ───
//
// Built from A's outputs rather than re-queried: an Electrum server may not
// surface an unconfirmed coin immediately, and waiting on a poll here would
// make the script flaky for no benefit.
const rescueTx = new TransactionBuilder({ provider });
rescueTx.addInput(
  {
    txid: splitReceipt.txid,
    vout: 1,
    satoshis: changeAmount,
  },
  keeper.unlockP2PKH(),
);
rescueTx.addBchChangeOutputIfNeeded({ to: keeperAddress, feeRate: 1 });

console.log('broadcasting change rescue…');
const rescueReceipt = await rescueTx.send();
console.log(`  txid: ${rescueReceipt.txid}`);
console.log(`  out 0: ${rescueTx.outputs[0]?.amount} sat  ← genesis input 2\n`);

console.log('Two vout-0 coins ready. Verify, then deploy:');
console.log('  npx tsx scripts/esahod/check-funding.ts');
console.log('  npx tsx scripts/esahod/01-deploy.ts');
