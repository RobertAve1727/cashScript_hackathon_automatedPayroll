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
import { binToHex, hexToBin } from '@bitauth/libauth';
import { gatherBchUtxos, utils } from 'cashscript';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { chipnetProvider, keyFromWif, pkhOf, requireEnv, toBytes20, writeDeployment } from './lib/config.js';

// Edit these before running against a real company deployment.
const EPHP_TOTAL_UNITS = 500_000_000n; // PHP 5,000,000.00 in centavos
const PERIOD_SECONDS = 1_314_873n;
const GENESIS_PERIODS_IN_PAST = 5n; // periods 0-4 immediately claimable — the demo trick
const LAPSE_SECONDS_FROM_NOW = 365n * 86_400n;
const GENESIS_DUST_SATOSHIS = 10_000n;

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
  const keeperAddress = binToHex(keeper.unlockP2PKH().generateLockingBytecode());
  const funding = await provider.getUtxosForLockingBytecode(keeperAddress);
  const spendable = funding.filter((utxo) => utxo.token === undefined);

  if (spendable.length < 2) {
    throw new Error(
      `the keeper needs at least 2 plain-BCH UTXOs to mint two token categories (found ${spendable.length}) — ` +
        'fund it at https://tbch4.googol.cash/ and split it into a couple of transactions first if needed',
    );
  }

  // ── Genesis 1: ePHP, straight to the treasury's tokenAddress ──────────
  const ephpInput = gatherBchUtxos(spendable.slice(0, 1), 1n).utxos[0]!;
  const pesoCategory = ephpInput.txid;

  const genesisTime = BigInt(Math.floor(Date.now() / 1000)) - GENESIS_PERIODS_IN_PAST * PERIOD_SECONDS;
  const lapseTime = BigInt(Math.floor(Date.now() / 1000)) + LAPSE_SECONDS_FROM_NOW;

  // ── Genesis 2: the employment category's minting NFT, to HR ───────────
  const employmentInput = gatherBchUtxos(
    spendable.filter((utxo) => utxo.txid !== ephpInput.txid),
    1n,
  ).utxos[0]!;
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

  const mintEphp = new TransactionBuilder({ provider });
  mintEphp.addInput(ephpInput, keeper.unlockP2PKH());
  mintEphp.addOutput({
    to: deployment.treasury.tokenAddress,
    amount: GENESIS_DUST_SATOSHIS,
    token: { amount: EPHP_TOTAL_UNITS, category: pesoCategory },
  });
  mintEphp.addBchChangeOutputIfNeeded({ to: keeperAddress, feeRate: 1 });
  console.log('broadcasting ePHP genesis...');
  const ephpReceipt = await mintEphp.send();
  console.log(`  ePHP category: ${pesoCategory}`);
  console.log(`  txid: ${ephpReceipt.txid}`);

  const mintEmployment = new TransactionBuilder({ provider });
  mintEmployment.addInput(employmentInput, keeper.unlockP2PKH());
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
    vaultLockingBytecode: deployment.vault.lockingBytecode,
  });

  console.log(`\ntreasury: ${deployment.treasury.address}`);
  console.log(`vault:    ${deployment.vault.address}`);
  console.log('\nDeployment written to scripts/esahod/deployment.json.');
}

await main();
