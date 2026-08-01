#!/usr/bin/env node
/**
 * Genesis-mint ePHP and the employment minting NFT, derive both contract
 * addresses, and write everything to `scripts/esahod/deployment.json`.
 *
 * CashTokens genesis is a real consensus rule, not a builder feature: a
 * newly minted token's category equals the *txid of the first input* of the
 * transaction that creates it. Minting two distinct categories therefore
 * needs two distinct genesis transactions (each spending a different funding
 * UTXO), which is why this script runs two transactions rather than one.
 *
 * Run: PAYROLL funding amount, remittance addresses and the funding-cycle
 * dates are prompted-for via flags below — see the constants at the top.
 *   npx tsx scripts/esahod/01-deploy.ts
 */
import { binToHex, encodeCashAddress, hexToBin } from '@bitauth/libauth';
import { utils } from 'cashscript';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { chipnetProvider, keyFromWif, pkhOf, requireEnv, toBytes20, writeDeployment } from './lib/config.js';

// Edit these before running against a real company deployment.
const EPHP_TOTAL_UNITS = 500_000_000n; // PHP 5,000,000.00 in centavos
const PERIOD_SECONDS = 1_314_873n;
const GENESIS_PERIODS_IN_PAST = 5n; // periods 0-4 immediately claimable — the demo trick
const LAPSE_SECONDS_FROM_NOW = 365n * 86_400n;
const GENESIS_DUST_SATOSHIS = 10_000n;
/** Output 0 of each genesis tx — the BCMR authchain head. Must stay keeper-controlled. */
const AUTHCHAIN_DUST_SATOSHIS = 1_000n;

async function main(): Promise<void> {
  const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
  const hr = keyFromWif(requireEnv('ESAHOD_HR_WIF'));
  const officer = keyFromWif(requireEnv('ESAHOD_OFFICER_WIF'));

  const sssPkh = toBytes20(requireEnv('ESAHOD_SSS_PKH'));
  const phicPkh = toBytes20(requireEnv('ESAHOD_PHIC_PKH'));
  const hdmfPkh = toBytes20(requireEnv('ESAHOD_HDMF_PKH'));
  const birPkh = toBytes20(requireEnv('ESAHOD_BIR_PKH'));
  const remitConfigHash = utils.hash160(Uint8Array.from([...sssPkh, ...phicPkh, ...hdmfPkh, ...birPkh]));

  const provider = chipnetProvider();
  // Two different things, and conflating them is why this line used to hand
  // cashscript a hex string where it wanted an address. The provider looks
  // coins up BY LOCKING BYTECODE; a transaction output is addressed by
  // CASHADDR. One value cannot be both.
  const keeperLockHex = binToHex(keeper.unlockP2PKH().generateLockingBytecode());
  const keeperAddress = encodeCashAddress({
    payload: pkhOf(keeper),
    prefix: 'bchtest',
    type: 'p2pkh',
  }).address;
  const funding = await provider.getUtxosForLockingBytecode(keeperLockHex);

  // A CashTokens category can ONLY be created by spending a UTXO whose
  // OUTPOINT INDEX IS ZERO, and the category id is that outpoint's txid. This
  // is consensus, not a library convention — see libauth's
  // `extractGenesisCategories`, which folds over the inputs and keeps only
  // those with `outpointIndex === 0`. Selecting any convenient coin (a change
  // output at vout 1, say) silently mints NOTHING while this script happily
  // records a category id that nothing on chain will ever match.
  const spendable = funding.filter((utxo) => utxo.token === undefined);
  const genesisCapable = spendable.filter((utxo) => utxo.vout === 0);

  if (genesisCapable.length < 2) {
    throw new Error(
      `two token categories need two separate UTXOs at OUTPOINT INDEX 0, and the keeper has ` +
        `${genesisCapable.length} of them (${spendable.length} spendable coins in total).\n` +
        'A CashTokens category is the txid of a vout-0 outpoint, so a coin sitting at vout 1 ' +
        '(a change output, typically) cannot mint anything.\n' +
        'Fix: send yourself two payments so each lands as output 0 of its own transaction — ' +
        'claim from https://tbch.googol.cash (CHIPNET) twice, or make two self-sends.',
    );
  }

  // ── Genesis 1: ePHP ───────────────────────────────────────────────────
  const ephpInput = genesisCapable[0]!;
  const pesoCategory = ephpInput.txid;

  const genesisTime = BigInt(Math.floor(Date.now() / 1000)) - GENESIS_PERIODS_IN_PAST * PERIOD_SECONDS;
  const lapseTime = BigInt(Math.floor(Date.now() / 1000)) + LAPSE_SECONDS_FROM_NOW;

  // ── Genesis 2: the employment category's minting NFT ──────────────────
  const employmentInput = genesisCapable.find((utxo) => utxo.txid !== ephpInput.txid);
  if (employmentInput === undefined) {
    throw new Error(
      'both vout-0 coins come from the same transaction, so they would mint the same category id — ' +
        'fund the keeper from two separate transactions',
    );
  }
  const employmentCategory = employmentInput.txid;

  const deployment = deployEsahod(
    provider,
    {
      employmentCategory: hexToBin(employmentCategory),
      pesoCategory: hexToBin(pesoCategory),
      remitConfigHash,
      genesisTime,
      periodSeconds: PERIOD_SECONDS,
      payrollOfficerPkh: pkhOf(officer),
      lapseTime,
    },
    pkhOf(hr),
  );

  const { TransactionBuilder } = await import('cashscript');

  // OUTPUT 0 IS RESERVED FOR THE AUTHCHAIN, IN BOTH GENESIS TRANSACTIONS.
  //
  // BCMR resolves a token's metadata by walking the "authchain": from the
  // genesis transaction (the authbase), it follows whichever transaction
  // spends OUTPUT 0, then that transaction's output 0, and so on. The tip is
  // the authhead, and only the authhead's OP_RETURN publication counts.
  //
  // So output 0 must stay under the keeper's control forever. If the token
  // itself sat at output 0, the first paySalary would spend it and the
  // authchain would follow that transaction's output 0 — which is the
  // employee's net pay. The chain would walk straight into an employee's
  // wallet and the token would stop resolving to a name in Paytaca.
  //
  // A dust output to the keeper costs ~1000 sats and keeps the chain ours.
  const mintEphp = new TransactionBuilder({ provider });
  mintEphp.addInput(ephpInput, keeper.unlockP2PKH());
  mintEphp.addOutput({ to: keeperAddress, amount: AUTHCHAIN_DUST_SATOSHIS }); // out 0 — authchain
  mintEphp.addOutput({
    to: deployment.treasury.tokenAddress,
    amount: GENESIS_DUST_SATOSHIS,
    token: { amount: EPHP_TOTAL_UNITS, category: pesoCategory },
  });
  mintEphp.addBchChangeOutputIfNeeded({ to: keeperAddress, feeRate: 1 });
  console.log('broadcasting ePHP genesis...');
  const ephpReceipt = await mintEphp.send();
  console.log(`  ePHP category: ${pesoCategory}`);
  console.log(`  txid: ${ephpReceipt.txid}  (authchain head = this txid:0)`);

  const mintEmployment = new TransactionBuilder({ provider });
  mintEmployment.addInput(employmentInput, keeper.unlockP2PKH());
  mintEmployment.addOutput({ to: keeperAddress, amount: AUTHCHAIN_DUST_SATOSHIS }); // out 0 — authchain
  mintEmployment.addOutput({
    to: hr.unlockP2PKH().generateLockingBytecode(),
    amount: GENESIS_DUST_SATOSHIS,
    token: { amount: 0n, category: employmentCategory, nft: { capability: 'minting', commitment: '' } },
  });
  mintEmployment.addBchChangeOutputIfNeeded({ to: keeperAddress, feeRate: 1 });
  console.log('broadcasting the employment-category minting NFT...');
  const employmentReceipt = await mintEmployment.send();
  console.log(`  employment category: ${employmentCategory}`);
  console.log(`  txid: ${employmentReceipt.txid}`);
  console.log(
    '\n  This minting NFT is still live — run 02-enrol-employees.ts NEXT, in the same funding cycle,\n' +
      '  which is the step that burns it. Until then, whoever holds it can forge an employment\n' +
      '  record; see contracts/payroll_treasury.cash and src/infrastructure/blockchain/esahod/genesis.ts.',
  );

  await writeDeployment({
    employmentCategory,
    pesoCategory,
    remitConfigHash: binToHex(remitConfigHash),
    genesisTime: genesisTime.toString(),
    periodSeconds: PERIOD_SECONDS.toString(),
    lapseTime: lapseTime.toString(),
    treasuryAddress: deployment.treasury.address,
    vaultAddress: deployment.vault.address,
    payrollOfficerPkh: binToHex(pkhOf(officer)),
    hrPkh: binToHex(pkhOf(hr)),
    vaultLockingBytecode: deployment.vault.lockingBytecode,
  });

  console.log(`\ntreasury: ${deployment.treasury.address}`);
  console.log(`vault:    ${deployment.vault.address}`);
  console.log('\nDeployment written to scripts/esahod/deployment.json.');
}

await main();
