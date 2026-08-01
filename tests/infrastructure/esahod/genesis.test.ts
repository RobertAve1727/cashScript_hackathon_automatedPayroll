import { binToHex } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, randomUtxo } from 'cashscript';
import { describe, expect, it } from 'vitest';
import {
  FIXTURE_ANALYST,
  FIXTURE_ENTRY_LEVEL,
  commitmentForEmployee,
  commitmentToHex,
  encodeCommitment,
} from '../../../src/domain/index.js';
import { buildGenesisEmploymentTransaction } from '../../../src/infrastructure/blockchain/esahod/genesis.js';
import { EMPLOYMENT_CATEGORY, employeePayeePkh, hexToBytes } from '../../support/esahod.js';

/**
 * Proves the fix for the CRITICAL finding from the security review round:
 * `paySalary` trusts the employment token category and nothing above it, so
 * whoever can mint an NFT of that category can forge an employment record.
 * The covenant cannot close this itself (the treasury/vault addresses are
 * circularly dependent), so the fix has to be procedural — mint every record
 * straight to the vault and destroy the minting authority in the same
 * transaction. This suite proves that procedure actually removes the minting
 * capability, and — for contrast — reproduces the mistake an earlier draft of
 * this project's tooling would have made (returning the baton to HR) to show
 * concretely what it would still allow.
 */

const hrMintingKey = new SignatureTemplate(hexToBytes('cc'.repeat(32)));
const attacker = new SignatureTemplate(hexToBytes('dd'.repeat(32)));
const vaultLockingBytecode = hexToBytes('a9146e' + '11'.repeat(31) + '87'); // arbitrary 34-byte stand-in

function mintingUtxoFor(provider: MockNetworkProvider, signer: SignatureTemplate) {
  const utxo = randomUtxo({
    satoshis: 10_000n,
    token: { amount: 0n, category: EMPLOYMENT_CATEGORY, nft: { capability: 'minting', commitment: '' } },
  });
  provider.addUtxo(binToHex(signer.unlockP2PKH().generateLockingBytecode()), utxo);
  return utxo;
}

describe('genesis employment minting — closing the forgery hole', () => {
  it('mints every employee straight into the vault with the mutable capability', async () => {
    const provider = new MockNetworkProvider();
    const mintingUtxo = mintingUtxoFor(provider, hrMintingKey);

    const commitmentA = commitmentToHex(
      encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
    );
    const commitmentB = commitmentToHex(
      encodeCommitment(commitmentForEmployee(FIXTURE_ENTRY_LEVEL, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
    );

    const builder = buildGenesisEmploymentTransaction({
      provider,
      mintingUtxo,
      mintingSigner: hrMintingKey,
      vaultLockingBytecode,
      employees: [{ commitmentHex: commitmentA }, { commitmentHex: commitmentB }],
      changeAddress: hrMintingKey.unlockP2PKH().generateLockingBytecode(),
    });

    await expect(builder.send()).resolves.toBeDefined();

    const vaultUtxos = await provider.getUtxosForLockingBytecode(vaultLockingBytecode);
    expect(vaultUtxos).toHaveLength(2);
    expect(vaultUtxos.every((utxo) => utxo.token?.nft?.capability === 'mutable')).toBe(true);
    expect(vaultUtxos.map((utxo) => utxo.token?.nft?.commitment).sort()).toEqual([commitmentA, commitmentB].sort());
  });

  it('destroys the minting authority — no output anywhere recreates it', async () => {
    const provider = new MockNetworkProvider();
    const mintingUtxo = mintingUtxoFor(provider, hrMintingKey);

    const commitment = commitmentToHex(
      encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
    );

    const builder = buildGenesisEmploymentTransaction({
      provider,
      mintingUtxo,
      mintingSigner: hrMintingKey,
      vaultLockingBytecode,
      employees: [{ commitmentHex: commitment }],
      changeAddress: hrMintingKey.unlockP2PKH().generateLockingBytecode(),
    });

    // Structural proof, independent of the network accepting it: nothing this
    // function builds ever re-outputs a minting-capability NFT.
    expect(builder.outputs.every((output) => output.token?.nft?.capability !== 'minting')).toBe(true);

    await builder.send();

    // Behavioural proof: after broadcast, HR's own holdings contain no
    // minting-capability UTXO of this category — the baton is simply gone.
    const hrUtxosAfter = await provider.getUtxosForLockingBytecode(hrMintingKey.unlockP2PKH().generateLockingBytecode());
    expect(hrUtxosAfter.some((utxo) => utxo.token?.nft?.capability === 'minting')).toBe(false);
  });

  it(
    'CONTRAST — the mistake this replaces: returning the baton to HR leaves forgery possible',
    async () => {
      const provider = new MockNetworkProvider();
      const mintingUtxo = mintingUtxoFor(provider, hrMintingKey);

      // The flawed pattern: issue one legitimate record, but RECREATE the
      // minting-capability output back to HR "for future hires" — exactly
      // what an earlier draft of this project's chipnet scripts specified.
      const legitimateCommitment = commitmentToHex(
        encodeCommitment(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: employeePayeePkh, nextPeriod: 0, endPeriod: 23 })),
      );
      const flawedGenesis = new (await import('cashscript')).TransactionBuilder({ provider });
      flawedGenesis.addInput(mintingUtxo, hrMintingKey.unlockP2PKH());
      flawedGenesis.addOutput({
        to: vaultLockingBytecode,
        amount: 1_000n,
        token: { amount: 0n, category: EMPLOYMENT_CATEGORY, nft: { capability: 'mutable', commitment: legitimateCommitment } },
      });
      // THE MISTAKE: keeps the baton alive, with enough satoshis to fund a
      // later forged mint on its own.
      flawedGenesis.addOutput({
        to: hrMintingKey.unlockP2PKH().generateLockingBytecode(),
        amount: 8_000n,
        token: { amount: 0n, category: EMPLOYMENT_CATEGORY, nft: { capability: 'minting', commitment: '' } },
      });
      flawedGenesis.addBchChangeOutputIfNeeded({ to: hrMintingKey.unlockP2PKH().generateLockingBytecode(), feeRate: 1 });
      await flawedGenesis.send();

      // Whoever holds that surviving baton — HR, or an attacker who stole
      // HR's key — can still mint a forged record straight to their own
      // wallet, of the SAME trusted category, at any time.
      const [survivingBaton] = await provider.getUtxosForLockingBytecode(
        hrMintingKey.unlockP2PKH().generateLockingBytecode(),
      );
      expect(survivingBaton?.token?.nft?.capability).toBe('minting');

      const forgedCommitment = commitmentToHex(
        encodeCommitment(
          commitmentForEmployee(
            { ...FIXTURE_ANALYST, monthlyBasic: 2_000_000_000n }, // the largest salary the 4-byte field holds
            { payeePkh: attacker.getPublicKey().slice(0, 20), nextPeriod: 0, endPeriod: 32000 },
          ),
        ),
      );
      const forge = new (await import('cashscript')).TransactionBuilder({ provider });
      forge.addInput(survivingBaton!, hrMintingKey.unlockP2PKH());
      forge.addOutput({
        // Straight to the attacker's own P2PKH — NOT the vault. Nothing stops this.
        to: attacker.unlockP2PKH().generateLockingBytecode(),
        amount: 1_000n,
        token: { amount: 0n, category: EMPLOYMENT_CATEGORY, nft: { capability: 'mutable', commitment: forgedCommitment } },
      });
      forge.addBchChangeOutputIfNeeded({ to: hrMintingKey.unlockP2PKH().generateLockingBytecode(), feeRate: 1 });

      await expect(forge.send()).resolves.toBeDefined();
      const attackerUtxos = await provider.getUtxosForLockingBytecode(attacker.unlockP2PKH().generateLockingBytecode());
      expect(attackerUtxos[0]?.token?.nft?.commitment).toBe(forgedCommitment);

      // This is exactly what buildGenesisEmploymentTransaction prevents: the
      // fixed version never produces the first output that made this possible.
    },
  );
});
