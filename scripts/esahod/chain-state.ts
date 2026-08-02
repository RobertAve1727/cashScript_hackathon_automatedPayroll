#!/usr/bin/env node
/** Print the treasury balance and every employment record. Read-only. */
import { hexToBin } from '@bitauth/libauth';
import { decodeCommitment } from '../../src/domain/index.js';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { chipnetProvider, keyFromWif, pkhOf, readDeployment, requireEnv, toBytes20 } from './lib/config.js';

const d = await readDeployment();
const provider = chipnetProvider();
const deployed = deployEsahod(
  provider,
  {
    employmentCategory: hexToBin(d.employmentCategory!),
    pesoCategory: hexToBin(d.pesoCategory!),
    remitConfigHash: hexToBin(d.remitConfigHash!),
    genesisTime: BigInt(d.genesisTime!),
    periodSeconds: BigInt(d.periodSeconds!),
    payrollOfficerPkh: pkhOf(keyFromWif(requireEnv('ESAHOD_OFFICER_WIF'))),
    lapseTime: BigInt(d.lapseTime!),
  },
  toBytes20(d.hrPkh!),
);

const treasury = await deployed.treasury.getUtxos();
const balance = treasury
  .filter((u) => u.token?.category === d.pesoCategory)
  .reduce((sum, u) => sum + (u.token?.amount ?? 0n), 0n);

const peso = (c: bigint): string => `₱${(Number(c) / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 })}`;
console.log(`treasury ePHP : ${peso(balance)}`);

for (const utxo of await deployed.vault.getUtxos()) {
  const hex = utxo.token?.nft?.commitment;
  if (hex === undefined || hex === '') continue;
  const r = decodeCommitment(hexToBin(hex));
  console.log(
    `employee #${r.employeeNo} : nextPeriod=${r.nextPeriod} end=${r.endPeriod} status=${r.status} basic=${peso(r.monthlyBasic)}`,
  );
}
