#!/usr/bin/env node
/**
 * The payroll daemon — what makes "permissionless" into "hands-off".
 *
 * ══ WHY THIS EXISTS ═════════════════════════════════════════════════════
 *
 * Bitcoin Cash has no scheduler. There is no cron in a covenant and no
 * transaction that submits itself, so something off chain has to press send.
 * That is the one part of eSahod that is not enforced by consensus, and
 * pretending otherwise would be the easiest lie in the pitch.
 *
 * What consensus DOES enforce is everything that matters about the send:
 *
 *   - it cannot happen early     `tx.time >= genesisTime + period × periodSeconds`
 *   - it cannot pay the wrong person, or the wrong amount, or skip an agency
 *   - it cannot happen twice     the period counter only moves forward
 *
 * So the sender has no discretion. Which is why this daemon is not a trusted
 * component: `paySalary` takes no signature, so ANYONE can run it — the
 * employer, the employee, a union, a public watchtower. If this process dies,
 * an employee can claim their own pay from a laptop and get the identical
 * transaction. That is the difference from an ordinary payroll, where nothing
 * happens until the employer acts.
 *
 * The only key this holds is a fee source. It cannot redirect a centavo.
 *
 * ══ WHAT IT DOES ════════════════════════════════════════════════════════
 *
 * Wakes on an interval, reads every employment record in the vault, and for
 * each one whose next period has come due, builds and broadcasts the payroll
 * transaction. Then goes back to sleep.
 *
 * Run: ESAHOD_KEEPER_WIF=… npx tsx scripts/esahod/payroll-daemon.ts [--once]
 *      ESAHOD_SSS_PKH=… ESAHOD_PHIC_PKH=… ESAHOD_HDMF_PKH=… ESAHOD_BIR_PKH=…
 */
import { encodeCashAddress, hexToBin } from '@bitauth/libauth';
import { commitmentFromHex, decodeCommitment } from '../../src/domain/index.js';
import { deployEsahod } from '../../src/infrastructure/blockchain/esahod/addresses.js';
import { buildPaySalaryTransaction } from '../../src/infrastructure/blockchain/esahod/payroll-transaction.js';
import {
  chipnetProvider,
  keyFromWif,
  pkhOf,
  readDeployment,
  requireEnv,
  toBytes20,
} from './lib/config.js';

/** How often to look. Far shorter than a pay period; the covenant is the clock. */
const POLL_SECONDS = 60;

const runOnce = process.argv.includes('--once');

const deployment = await readDeployment();
for (const field of [
  'employmentCategory',
  'pesoCategory',
  'remitConfigHash',
  'genesisTime',
  'periodSeconds',
  'lapseTime',
  'treasuryAddress',
  'vaultAddress',
  'payrollOfficerPkh',
  'hrPkh',
] as const) {
  if (deployment[field] === undefined) {
    throw new Error(`deployment.json has no ${field} — run 01-deploy.ts first`);
  }
}

const keeper = keyFromWif(requireEnv('ESAHOD_KEEPER_WIF'));
const keeperLockHex = Buffer.from(keeper.unlockP2PKH().generateLockingBytecode()).toString('hex');
const keeperAddress = encodeCashAddress({
  payload: pkhOf(keeper),
  prefix: 'bchtest',
  type: 'p2pkh',
}).address;

const remitConfig = {
  sssPkh: toBytes20(requireEnv('ESAHOD_SSS_PKH')),
  phicPkh: toBytes20(requireEnv('ESAHOD_PHIC_PKH')),
  hdmfPkh: toBytes20(requireEnv('ESAHOD_HDMF_PKH')),
  birPkh: toBytes20(requireEnv('ESAHOD_BIR_PKH')),
};

const genesisTime = BigInt(deployment.genesisTime!);
const periodSeconds = BigInt(deployment.periodSeconds!);
const provider = chipnetProvider();

const { treasury, vault } = deployEsahod(
  provider,
  {
    employmentCategory: hexToBin(deployment.employmentCategory!),
    pesoCategory: hexToBin(deployment.pesoCategory!),
    remitConfigHash: hexToBin(deployment.remitConfigHash!),
    genesisTime,
    periodSeconds,
    periodsPerMonth: BigInt(deployment.periodsPerMonth ?? '2'),
    payrollOfficerPkh: toBytes20(deployment.payrollOfficerPkh!),
    lapseTime: BigInt(deployment.lapseTime!),
  },
  toBytes20(deployment.hrPkh!),
);

// A contract's address IS the hash of its constructor arguments, so a single
// wrong argument yields a different address and every spend fails with an
// error about a missing UTXO rather than about the mismatch. Checking the
// rebuild against the recorded addresses turns that into one clear message.
if (treasury.address !== deployment.treasuryAddress || vault.address !== deployment.vaultAddress) {
  throw new Error(
    'rebuilt contracts do not match the deployment:\n' +
      `  treasury expected ${deployment.treasuryAddress}\n` +
      `           rebuilt  ${treasury.address}\n` +
      `  vault    expected ${deployment.vaultAddress}\n` +
      `           rebuilt  ${vault.address}\n` +
      'One of the constructor arguments in deployment.json is wrong.',
  );
}

const stamp = (): string => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** Unix seconds at which a period becomes claimable. */
function payableAt(period: number): bigint {
  return genesisTime + BigInt(period) * periodSeconds;
}

async function sweep(): Promise<void> {
  const now = BigInt(Math.floor(Date.now() / 1000));

  const [treasuryUtxos, vaultUtxos, feeUtxos] = await Promise.all([
    provider.getUtxos(deployment.treasuryAddress!),
    provider.getUtxos(deployment.vaultAddress!),
    provider.getUtxosForLockingBytecode(keeperLockHex),
  ]);

  const treasuryUtxo = treasuryUtxos.find((utxo) => utxo.token?.category === deployment.pesoCategory);
  if (!treasuryUtxo) {
    console.log(`${stamp()}  treasury holds no ePHP — nothing to disburse`);
    return;
  }

  const records = vaultUtxos.filter(
    (utxo) => utxo.token?.category === deployment.employmentCategory && utxo.token?.nft !== undefined,
  );
  const fee = feeUtxos.filter((utxo) => utxo.token === undefined).sort((a, b) => Number(b.satoshis - a.satoshis))[0];
  if (!fee) {
    console.log(`${stamp()}  keeper has no plain coin to pay a fee — top up ${keeperAddress}`);
    return;
  }

  let due = 0;
  for (const record of records) {
    const commitment = decodeCommitment(commitmentFromHex(record.token!.nft!.commitment));
    const unlocksAt = payableAt(commitment.nextPeriod);

    if (now < unlocksAt) continue;
    if (commitment.nextPeriod > commitment.endPeriod) continue;
    if (commitment.status !== 1) continue;

    due += 1;
    try {
      const tx = buildPaySalaryTransaction({
        provider,
        treasury,
        vault,
        treasuryUtxo,
        nftUtxo: record,
        feeUtxos: [fee],
        feeSigner: keeper,
        feeChangeAddress: keeper.unlockP2PKH().generateLockingBytecode(),
        remitConfig,
        genesisTime,
        periodSeconds,
        // Must match what the treasury was DEPLOYED with. Without it this
        // defaults to semi-monthly and silently builds the wrong amounts for a
        // weekly or daily treasury — the covenant then rejects the transaction
        // with "output 0 must be exactly net pay", which says nothing about
        // cadence.
        periodsPerMonth: BigInt(deployment.periodsPerMonth ?? '2'),
      });
      const receipt = await tx.send();
      console.log(
        `${stamp()}  PAID  #${commitment.employeeNo} period ${commitment.nextPeriod}  txid ${receipt.txid}`,
      );
      // One per sweep: the treasury coin just moved, so every other record's
      // transaction would reference a spent input. The next tick picks them up.
      return;
    } catch (error) {
      console.log(
        `${stamp()}  FAILED #${commitment.employeeNo} period ${commitment.nextPeriod}: ` +
          `${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
      );
      return;
    }
  }

  if (due === 0) {
    const next = records
      .map((r) => decodeCommitment(commitmentFromHex(r.token!.nft!.commitment)))
      .filter((c) => c.nextPeriod <= c.endPeriod && c.status === 1)
      .map((c) => payableAt(c.nextPeriod))
      .sort((a, b) => Number(a - b))[0];

    console.log(
      `${stamp()}  nothing due (${records.length} record(s))` +
        (next === undefined ? '' : `; next payday ${new Date(Number(next) * 1000).toISOString().slice(0, 16)}`),
    );
  }
}

console.log(`eSahod payroll daemon — ${runOnce ? 'single sweep' : `polling every ${POLL_SECONDS}s`}`);
console.log(`  treasury ${deployment.treasuryAddress}`);
console.log(`  fees from ${keeperAddress}`);
console.log('  this process holds a FEE key only — it cannot redirect a payment\n');

await sweep();

if (!runOnce) {
  setInterval(() => {
    void sweep().catch((error: unknown) => {
      // A dropped connection must not kill the daemon: the next tick retries,
      // and the covenant makes a late payment indistinguishable from a
      // punctual one except in when it lands.
      console.log(`${stamp()}  sweep error: ${error instanceof Error ? error.message : String(error)}`);
    });
  }, POLL_SECONDS * 1000);
}
