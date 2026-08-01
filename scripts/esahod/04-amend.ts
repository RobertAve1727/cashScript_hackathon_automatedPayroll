#!/usr/bin/env node
/**
 * HR-signed amendment: change salary/allowance/tax, suspend or reinstate,
 * separate an employee, or relocate a record into a new vault at the start
 * of a funding cycle. Cannot rewind `nextPeriod` — the covenant refuses it.
 *
 * Run:
 *   npx tsx scripts/esahod/04-amend.ts --employee-pkh <hex> [--salary <pesos>]
 *     [--allowance <pesos>] [--tax <pesos>] [--status active|suspended]
 *     [--end-period <n>] [--relocate-to <hex-locking-bytecode>]
 */
import { hexToBin } from '@bitauth/libauth';
import { TransactionBuilder } from 'cashscript';
import { commitmentToHex, decodeCommitment, encodeCommitment } from '../../src/domain/index.js';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { chipnetProvider, keyFromWif, pkhOf, readDeployment, readArg, requireEnv } from './lib/config.js';

function pesosToCentavos(pesos: string): bigint {
  const [whole = '0', fraction = ''] = pesos.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

async function main(): Promise<void> {
  const deployment = await readDeployment();
  if (deployment.employmentCategory === undefined || deployment.vaultLockingBytecode === undefined) {
    throw new Error('run 01-deploy.ts and 02-enrol-employees.ts first');
  }

  const employeePkhHex = readArg(process.argv, '--employee-pkh');
  if (employeePkhHex === undefined) throw new Error('pass --employee-pkh <20-byte hex>');

  const hr = keyFromWif(requireEnv('ESAHOD_HR_WIF'));
  const officer = keyFromWif(requireEnv('ESAHOD_OFFICER_WIF'));
  const provider = chipnetProvider();

  const deployed = deployEsahod(
    provider,
    {
      employmentCategory: hexToBin(deployment.employmentCategory),
      pesoCategory: hexToBin(requireEnv('ESAHOD_PESO_CATEGORY')),
      remitConfigHash: hexToBin(requireEnv('ESAHOD_REMIT_CONFIG_HASH')),
      genesisTime: BigInt(deployment.genesisTime ?? '0'),
      periodSeconds: BigInt(deployment.periodSeconds ?? '0'),
      payrollOfficerPkh: pkhOf(officer),
      lapseTime: BigInt(deployment.lapseTime ?? '0'),
    },
    pkhOf(hr),
  );

  const vaultUtxos = await deployed.vault.getUtxos();
  const nftUtxo = vaultUtxos.find(
    (utxo) => (utxo.token?.nft?.commitment ?? '').slice(0, 40).toLowerCase() === employeePkhHex.toLowerCase(),
  );
  if (nftUtxo === undefined) throw new Error(`no employment record in the vault for payee ${employeePkhHex}`);

  const current = decodeCommitment(hexToBin(nftUtxo.token!.nft!.commitment));

  const salaryFlag = readArg(process.argv, '--salary');
  const allowanceFlag = readArg(process.argv, '--allowance');
  const taxFlag = readArg(process.argv, '--tax');
  const statusFlag = readArg(process.argv, '--status');
  const endPeriodFlag = readArg(process.argv, '--end-period');
  const relocateTo = readArg(process.argv, '--relocate-to');

  const amended = encodeCommitment({
    payeePkh: current.payeePkh,
    monthlyBasic: salaryFlag !== undefined ? pesosToCentavos(salaryFlag) : current.monthlyBasic,
    monthlyAllowance: allowanceFlag !== undefined ? pesosToCentavos(allowanceFlag) : current.monthlyAllowance,
    taxPerPeriod: taxFlag !== undefined ? pesosToCentavos(taxFlag) : current.taxPerPeriod,
    nextPeriod: current.nextPeriod, // amend() forbids moving this backwards; only paySalary advances it
    endPeriod: endPeriodFlag !== undefined ? Number(endPeriodFlag) : current.endPeriod,
    status: statusFlag === undefined ? current.status : statusFlag === 'active' ? 1 : 0,
    employeeNo: current.employeeNo,
  });

  const destination = relocateTo !== undefined ? hexToBin(relocateTo) : hexToBin(deployment.vaultLockingBytecode);

  const builder = new TransactionBuilder({ provider });
  builder.addInput(nftUtxo, deployed.vault.unlock.amend(hr, hr.getPublicKey()));

  const feeAddress = hr.unlockP2PKH().generateLockingBytecode();
  const feeUtxos = (await provider.getUtxosForLockingBytecode(feeAddress)).filter((utxo) => utxo.token === undefined);
  if (feeUtxos.length > 0) builder.addInput(feeUtxos[0]!, hr.unlockP2PKH());

  builder.addOutput({
    to: destination,
    amount: nftUtxo.satoshis,
    token: { amount: 0n, category: nftUtxo.token!.category, nft: { capability: 'mutable', commitment: commitmentToHex(amended) } },
  });
  builder.addBchChangeOutputIfNeeded({ to: feeAddress, feeRate: 1 });

  console.log('broadcasting amend...');
  const receipt = await builder.send();
  console.log(`  txid: ${receipt.txid}`);
  if (relocateTo !== undefined) {
    console.log(`  relocated to: ${relocateTo} — update scripts/esahod/deployment.json for the new cycle`);
  }
}

await main();
