#!/usr/bin/env node
/**
 * Run one paySalary transaction for one employee. Permissionless — this
 * script does not need HR's or the officer's key, only a fee payer. The
 * employee's own copy of this script would work identically, which is the
 * entire point.
 *
 * Run: npx tsx scripts/esahod/03-run-payroll.ts --employee-pkh <hex>
 */
import { hexToBin } from '@bitauth/libauth';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { buildPaySalaryTransaction } from '../../src/infrastructure/blockchain/esahod/payroll-transaction.js';
import { chipnetProvider, keyFromWif, pkhOf, readDeployment, readArg, requireEnv, selectFeeUtxos, toBytes20 } from './lib/config.js';

async function main(): Promise<void> {
  const deployment = await readDeployment();
  if (deployment.employmentCategory === undefined || deployment.pesoCategory === undefined) {
    throw new Error('run 01-deploy.ts and 02-enrol-employees.ts first');
  }

  const employeePkhHex = readArg(process.argv, '--employee-pkh');
  if (employeePkhHex === undefined) {
    throw new Error('pass --employee-pkh <20-byte hex> — the payee hash inside the employment record to pay');
  }

  const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
  const officer = keyFromWif(requireEnv('ESAHOD_OFFICER_WIF'));
  const sssPkh = toBytes20(requireEnv('ESAHOD_SSS_PKH'));
  const phicPkh = toBytes20(requireEnv('ESAHOD_PHIC_PKH'));
  const hdmfPkh = toBytes20(requireEnv('ESAHOD_HDMF_PKH'));
  const birPkh = toBytes20(requireEnv('ESAHOD_BIR_PKH'));

  const provider = chipnetProvider();
  const deployed = deployEsahod(
    provider,
    {
      employmentCategory: hexToBin(deployment.employmentCategory),
      pesoCategory: hexToBin(deployment.pesoCategory),
      remitConfigHash: hexToBin(requireEnv('ESAHOD_REMIT_CONFIG_HASH')),
      genesisTime: BigInt(deployment.genesisTime ?? '0'),
      periodSeconds: BigInt(deployment.periodSeconds ?? '0'),
      periodsPerMonth: BigInt(deployment.periodsPerMonth ?? '2'),
      payrollOfficerPkh: pkhOf(officer),
      lapseTime: BigInt(deployment.lapseTime ?? '0'),
    },
    toBytes20(requireEnv('ESAHOD_HR_PKH')),
  );

  const [treasuryUtxo] = await deployed.treasury.getUtxos();
  if (treasuryUtxo === undefined) throw new Error('the treasury has no funds — nothing to pay from');

  const vaultUtxos = await deployed.vault.getUtxos();
  const nftUtxo = vaultUtxos.find((utxo) => {
    if (utxo.token === undefined || utxo.token.category !== deployment.employmentCategory) return false;
    return (utxo.token.nft?.commitment ?? '').slice(0, 40).toLowerCase() === employeePkhHex.toLowerCase();
  });
  if (nftUtxo === undefined) throw new Error(`no employment record in the vault for payee ${employeePkhHex}`);

  const feeAddress = keeper.unlockP2PKH().generateLockingBytecode();
  const feeUtxos = selectFeeUtxos(await provider.getUtxosForLockingBytecode(feeAddress));

  const builder = buildPaySalaryTransaction({
    provider,
    treasury: deployed.treasury,
    vault: deployed.vault,
    treasuryUtxo,
    nftUtxo,
    feeUtxos,
    feeSigner: keeper,
    feeChangeAddress: feeAddress,
    remitConfig: { sssPkh, phicPkh, hdmfPkh, birPkh },
    genesisTime: BigInt(deployment.genesisTime ?? '0'),
    periodSeconds: BigInt(deployment.periodSeconds ?? '0'),
    periodsPerMonth: BigInt(deployment.periodsPerMonth ?? '2'),
  });

  console.log('broadcasting paySalary...');
  const receipt = await builder.send();
  console.log(`  txid: ${receipt.txid}`);
  console.log(`  https://chipnet.imaginary.cash/tx/${receipt.txid}`);
}

await main();
