#!/usr/bin/env node
/**
 * Mint every employment record directly into the vault and destroy the
 * minting authority in the same transaction — see
 * `src/infrastructure/blockchain/esahod/genesis.ts` for why this is the fix
 * for the one hole the covenant cannot close by itself.
 *
 * Must run in the same funding cycle as 01-deploy.ts, before the minting NFT
 * it created is used for anything else. There is no "add one more employee
 * later" path from this script on purpose — see `genesis.ts`'s comment for
 * the covenant-guarded extension if that is needed.
 *
 * Run: npx tsx scripts/esahod/02-enrol-employees.ts
 */
import { binToHex, hexToBin } from '@bitauth/libauth';
import { commitmentForEmployee, commitmentToHex, encodeCommitment, FIXTURES } from '../../src/domain/index.js';
import { buildGenesisEmploymentTransaction } from '../../src/infrastructure/blockchain/esahod/genesis.js';
import { chipnetProvider, keyFromWif, requireEnv, toBytes20 } from './lib/config.js';
import { readDeployment } from './lib/config.js';

async function main(): Promise<void> {
  const deployment = await readDeployment();
  if (deployment.employmentCategory === undefined || deployment.vaultLockingBytecode === undefined) {
    throw new Error('run 01-deploy.ts first — scripts/esahod/deployment.json has no employment deployment yet');
  }

  const hr = keyFromWif(requireEnv('ESAHOD_HR_WIF'));
  const provider = chipnetProvider();

  const hrAddress = binToHex(hr.unlockP2PKH().generateLockingBytecode());
  const mintingUtxo = (await provider.getUtxosForLockingBytecode(hrAddress)).find(
    (utxo) => utxo.token?.nft?.capability === 'minting' && utxo.token.category === deployment.employmentCategory,
  );

  if (mintingUtxo === undefined) {
    throw new Error(
      'no employment-category minting NFT found at the HR address — did 01-deploy.ts finish, and is this the same key?',
    );
  }

  // The two shipped fixtures. Replace with a real roster before using this
  // for anything but a demo.
  const employees = FIXTURES.map((fixture, index) => ({
    commitmentHex: commitmentToHex(
      encodeCommitment(
        commitmentForEmployee(fixture, {
          payeePkh: toBytes20(requireEnv(`ESAHOD_EMPLOYEE_${index + 1}_PKH`)),
          nextPeriod: 0,
          endPeriod: 23,
        }),
      ),
    ),
    name: fixture.name,
  }));

  const builder = buildGenesisEmploymentTransaction({
    provider,
    mintingUtxo,
    mintingSigner: hr,
    vaultLockingBytecode: hexToBin(deployment.vaultLockingBytecode),
    employees,
    changeAddress: hrAddress,
  });

  console.log(`enrolling ${employees.length} employee(s) and burning the minting NFT...`);
  const receipt = await builder.send();
  for (const employee of employees) console.log(`  enrolled: ${employee.name}`);
  console.log(`  txid: ${receipt.txid}`);
  console.log('\nThe employment-category minting NFT no longer exists anywhere. No further records of');
  console.log('this category can ever be minted — see tests/infrastructure/esahod/genesis.test.ts.');
}

await main();
