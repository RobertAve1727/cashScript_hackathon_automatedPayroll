import { describe, expect, it } from 'vitest';
import { TransactionBuilder } from 'cashscript';
import { hexToBin } from '@bitauth/libauth';
import {
  FIXTURE_ANALYST,
  commitmentForEmployee,
  commitmentToHex,
  encodeCommitment,
} from '../../../src/domain/index.js';
import {
  buildTx,
  employeePayeePkh,
  feePayer,
  feePayerLockingBytecode,
  fundScenario,
  hr,
} from '../../support/esahod.js';

/**
 * The claim under test: an employment record that has run past its contract
 * window stops being payable, and an HR-signed amendment brings it back.
 *
 * Expiry is the covenant's own rule — `require(period <= endPeriod)` in
 * paySalary — so a fixed-term hire stops being paid without anyone remembering
 * to switch them off. The question this file answers is whether that is
 * reversible, because "the contract ended" and "this record is dead forever"
 * are very different things for a renewal, a probationary period that was
 * confirmed, or a contract extended by a month.
 *
 * The vault's `amend` constrains exactly two things: the record keeps its
 * category and mutable capability, and `nextPeriod` never moves backwards. It
 * says nothing about `endPeriod`. That silence is what makes renewal possible,
 * and it is deliberate — moving the window is the employer's lawful
 * prerogative, while reopening a period already paid is theft.
 */

function amendTo(
  scenario: ReturnType<typeof fundScenario>,
  newCommitmentHex: string,
): TransactionBuilder {
  const builder = new TransactionBuilder({ provider: scenario.provider });

  builder.addInput(scenario.nftUtxo, scenario.deployment.vault.unlock.amend(hr, hr.getPublicKey()));
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

/** A record whose window has run out: period 6 is past an endPeriod of 5. */
const expired = () => fundScenario(FIXTURE_ANALYST, { nextPeriod: 6, endPeriod: 5 });

describe('a record past its contract window', () => {
  it('stops being payable, by the covenant rather than by anyone remembering', async () => {
    await expect(buildTx(expired()).send()).rejects.toThrow(/employment record has ended/);
  });

  it('is still a live record in the vault — expiry is not destruction', () => {
    // The NFT is untouched and still mutable. Nothing about running out of
    // window removes it, which is precisely why renewal has something to act
    // on: a record that had been burned could not be extended.
    const scenario = expired();

    expect(scenario.nftUtxo.token?.nft?.capability).toBe('mutable');
    expect(scenario.nftUtxo.token?.nft?.commitment).toBeTruthy();
  });
});

describe('renewal', () => {
  it('an HR-signed amendment extends the window and the record pays again', async () => {
    const scenario = expired();

    // HR extends the term. Everything else in the 40 bytes is left alone —
    // this is a renewal, not a re-hire on new terms.
    const renewed = commitmentToHex(
      encodeCommitment(
        commitmentForEmployee(FIXTURE_ANALYST, {
          payeePkh: employeePayeePkh,
          nextPeriod: 6,
          endPeriod: 23,
        }),
      ),
    );

    await expect(amendTo(scenario, renewed).send()).resolves.toBeDefined();

    // And the renewed record is payable, which is the whole point: extending
    // the window is not a bookkeeping change, it restores the covenant path.
    const after = fundScenario(FIXTURE_ANALYST, { nextPeriod: 6, endPeriod: 23 });
    await expect(buildTx(after).send()).resolves.toBeDefined();
  });

  it('does NOT let the renewal reopen a period already paid', async () => {
    // The clause that survives a compromised HR key. Renewal moves endPeriod
    // forward; it must not move nextPeriod back. A rewind of 24 would be a
    // second year's salary, claimable by anyone through the ordinary payroll
    // path, with no invalid transaction anywhere in sight.
    const scenario = expired();

    const rewound = commitmentToHex(
      encodeCommitment(
        commitmentForEmployee(FIXTURE_ANALYST, {
          payeePkh: employeePayeePkh,
          nextPeriod: 0,
          endPeriod: 23,
        }),
      ),
    );

    await expect(amendTo(scenario, rewound).send()).rejects.toThrow(
      /nextPeriod must never move backwards/,
    );
  });

  it('lets HR end a contract early by pulling the window into the past', async () => {
    // The same field, the other direction — separation. Lawful, signed, and
    // visible on chain, and it takes effect immediately rather than waiting
    // for anyone to disable an account.
    const scenario = fundScenario(FIXTURE_ANALYST, { nextPeriod: 3, endPeriod: 23 });

    const ended = commitmentToHex(
      encodeCommitment(
        commitmentForEmployee(FIXTURE_ANALYST, {
          payeePkh: employeePayeePkh,
          nextPeriod: 3,
          endPeriod: 2,
        }),
      ),
    );

    await expect(amendTo(scenario, ended).send()).resolves.toBeDefined();
    await expect(
      buildTx(fundScenario(FIXTURE_ANALYST, { nextPeriod: 3, endPeriod: 2 })).send(),
    ).rejects.toThrow(/employment record has ended/);
  });
});
