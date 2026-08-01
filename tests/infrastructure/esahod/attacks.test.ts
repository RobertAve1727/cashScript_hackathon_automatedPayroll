import { hexToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, TransactionBuilder, randomUtxo, type Output } from 'cashscript';
import { describe, expect, it } from 'vitest';
import { FIXTURE_ANALYST, commitmentForEmployee, commitmentToHex, encodeCommitment } from '../../../src/domain/index.js';
import { p2pkhLockingBytecode } from '../../../src/infrastructure/blockchain/esahod/p2pkh.js';
import {
  attackerPkh,
  buildTx,
  employeePayeePkh,
  feePayer,
  feePayerLockingBytecode,
  fundScenario,
  GENESIS_TIME,
  hr,
  hexToBytes,
} from '../../support/esahod.js';

/**
 * Each case here builds a transaction that is valid in every respect except
 * one deliberate mutation, and asserts the covenant rejects it with the exact
 * `require()` message that clause carries — not just that `send()` throws.
 * Matching the message is what proves the RIGHT check caught the attack,
 * rather than an unrelated one (or the builder itself) failing first.
 */

function replaceOutput(outputs: Output[], index: number, patch: Partial<Output>): Output[] {
  const target = outputs[index];
  if (target === undefined) throw new Error(`replaceOutput: no output at index ${index}`);

  const next = [...outputs];
  next[index] = { ...target, ...patch };
  return next;
}

async function expectRejected(builder: TransactionBuilder, messageFragment: string): Promise<void> {
  await expect(builder.send()).rejects.toThrow(new RegExp(messageFragment));
}

describe('paySalary — attack suite', () => {
  it('REDIRECT: rewriting the employee output to the attacker is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);

    builder.outputs = replaceOutput(builder.outputs, 0, { to: p2pkhLockingBytecode(attackerPkh) });

    await expectRejected(builder, 'output 0 must pay the employee named in the record');
  });

  it('PERIOD NOT ADVANCED: resubmitting the same period in the NFT output is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);

    const unchangedCommitment = commitmentToHex(
      encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
    );
    builder.outputs = replaceOutput(builder.outputs, 5, {
      token: { ...builder.outputs[5]!.token!, nft: { capability: 'mutable', commitment: unchangedCommitment } },
    });

    await expectRejected(builder, 'only nextPeriod may change, and only by \\+1');
  });

  it('TAMPERED COMMITMENT: inflating the salary in the recommitted NFT is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);

    const inflatedCommitment = commitmentToHex(
      encodeCommitment(
        commitmentForEmployee(
          { ...FIXTURE_ANALYST, monthlyBasic: FIXTURE_ANALYST.monthlyBasic * 100n },
          { payeePkh: employeePayeePkh, nextPeriod: 1, endPeriod: 23 },
        ),
      ),
    );
    builder.outputs = replaceOutput(builder.outputs, 5, {
      token: { ...builder.outputs[5]!.token!, nft: { capability: 'mutable', commitment: inflatedCommitment } },
    });

    await expectRejected(builder, 'only nextPeriod may change, and only by \\+1');
  });

  it('EARLY CLAIM: a locktime one second before payday is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);

    builder.locktime = Number(GENESIS_TIME) - 1;

    await expectRejected(builder, 'payday for this period has not arrived');
  });

  it('WRONG CATEGORY: an NFT of a different token category is rejected', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST, { nftCategory: 'aa'.repeat(32) });

    await expectRejected(buildTx(scenario), 'input 1 must be a mutable Employment NFT of this company');
  });

  it('SUSPENDED: an inactive employment record cannot be paid', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST, { status: 0 });

    await expectRejected(buildTx(scenario), 'employee is not in active status');
  });

  it('ENDED: a record whose contract has ended cannot be paid', async () => {
    const scenario = fundScenario(FIXTURE_ANALYST, { nextPeriod: 5, endPeriod: 4 });

    await expectRejected(buildTx(scenario), 'employment record has ended');
  });

  // Both BCH-strip cases move the "stolen" satoshis into the transaction's
  // own existing BCH-change output (index 7) rather than pushing a brand new
  // output. Adding an output grows the transaction by real bytes, which drops
  // the fee rate below the builder's own minimum and rejects the transaction
  // before it ever reaches the VM — a builder-level failure that would prove
  // nothing about the covenant. Moving value between two outputs that already
  // exist keeps the byte count (and therefore the fee) identical, so the only
  // thing under test is the covenant's satoshi-floor check.
  it('BCH-STRIP (treasury): stripping the treasury change satoshis is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);
    const bchChangeIndex = builder.outputs.length - 1;

    const stolen = 2_000_000n;
    let outputs = replaceOutput(builder.outputs, 6, { amount: builder.outputs[6]!.amount - stolen });
    outputs = replaceOutput(outputs, bchChangeIndex, { amount: outputs[bchChangeIndex]!.amount + stolen });
    builder.outputs = outputs;

    await expectRejected(builder, 'the treasury must keep its satoshis');
  });

  it('BCH-STRIP (employment record): stripping the NFT satoshis is rejected', async () => {
    const scenario = fundScenario();
    const builder = buildTx(scenario);
    const bchChangeIndex = builder.outputs.length - 1;

    const stolen = 400n;
    let outputs = replaceOutput(builder.outputs, 5, { amount: builder.outputs[5]!.amount - stolen });
    outputs = replaceOutput(outputs, bchChangeIndex, { amount: outputs[bchChangeIndex]!.amount + stolen });
    builder.outputs = outputs;

    await expectRejected(builder, 'the employment record must keep its satoshis');
  });

  it('REPLAY: spending an already-consumed treasury/NFT pair a second time is rejected', async () => {
    const scenario = fundScenario();
    await buildTx(scenario).send(); // consumes treasuryUtxo + nftUtxo for real

    // Rebuild against the SAME (now-spent) UTXO references — a genuine double-spend attempt.
    await expect(buildTx(scenario).send()).rejects.toThrow();
  });

  describe('amend() — the HR path', () => {
    function buildAmendTx(
      scenario: ReturnType<typeof fundScenario>,
      signer: SignatureTemplate,
      newCommitmentHex: string,
    ): TransactionBuilder {
      const builder = new TransactionBuilder({ provider: scenario.provider });

      builder.addInput(scenario.nftUtxo, scenario.deployment.vault.unlock.amend(signer, hr.getPublicKey()));
      builder.addInput(scenario.feeUtxo, feePayer.unlockP2PKH());

      builder.addOutput({
        to: hexToBin(scenario.deployment.vault.lockingBytecode),
        amount: scenario.nftUtxo.satoshis,
        token: {
          amount: 0n,
          category: scenario.nftUtxo.token!.category,
          nft: { capability: 'mutable', commitment: newCommitmentHex },
        },
      });
      builder.addBchChangeOutputIfNeeded({ to: feePayerLockingBytecode, feeRate: 1 });

      return builder;
    }

    it('REWIND: HR writing an earlier nextPeriod is rejected — a stolen HR key cannot reopen a paid period', async () => {
      const scenario = fundScenario(FIXTURE_ANALYST, { nextPeriod: 10, endPeriod: 23 });
      const rewound = commitmentToHex(
        encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 5, endPeriod: 23 })),
      );

      await expectRejected(buildAmendTx(scenario, hr, rewound), 'nextPeriod must never move backwards');
    });

    it('FORGED SIGNATURE: a non-HR signer claiming to be HR is rejected', async () => {
      const scenario = fundScenario();
      const attacker = new SignatureTemplate(hexToBytes('ab'.repeat(32)));
      const sameCommitment = commitmentToHex(
        encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
      );

      // hrPk is genuinely HR's (the hash160 check passes) but the signature
      // comes from a different key, so checkSig must fail.
      await expect(buildAmendTx(scenario, attacker, sameCommitment).send()).rejects.toThrow();
    });

    it('a lawful HR relocation and salary change is accepted', async () => {
      const scenario = fundScenario(FIXTURE_ANALYST, { nextPeriod: 3, endPeriod: 23 });
      const raise = commitmentToHex(
        encodeCommitment(
          commitmentForEmployee(
            { ...FIXTURE_ANALYST, monthlyBasic: FIXTURE_ANALYST.monthlyBasic + 500_000n },
            { payeePkh: employeePayeePkh, nextPeriod: 3, endPeriod: 23 },
          ),
        ),
      );

      await expect(buildAmendTx(scenario, hr, raise).send()).resolves.toBeDefined();
    });
  });
});
