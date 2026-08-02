import { TransactionBuilder, type NetworkProvider, type SignatureTemplate, type Utxo } from 'cashscript';

export interface GenesisEmployee {
  /** The 40-byte commitment, hex-encoded (see `src/domain/payroll/commitment.ts`). */
  readonly commitmentHex: string;
  readonly satoshis?: bigint;
}

export interface BuildGenesisEmploymentTransactionOptions {
  readonly provider: NetworkProvider;
  /** The employment category's minting-capability UTXO. Spent exactly once, ever. */
  readonly mintingUtxo: Utxo;
  readonly mintingSigner: SignatureTemplate;
  /** The `EmploymentVault`'s locking bytecode — every record is minted straight into it. */
  readonly vaultLockingBytecode: Uint8Array;
  readonly employees: readonly GenesisEmployee[];
  readonly changeAddress: string | Uint8Array;
  readonly feeRateSatsPerByte?: number;
}

const DEFAULT_NFT_DUST_SATOSHIS = 1_000n;

/**
 * Mint every employment record for a company in one transaction, and destroy
 * the minting baton in the same transaction.
 *
 * This is the fix for the one hole the covenant cannot close on its own — see
 * `contracts/payroll_treasury.cash`'s "THE TRUST ROOT" comment. `paySalary`
 * trusts the employment token CATEGORY, and anyone holding that category's
 * minting authority could otherwise mint a forged record straight to their
 * own wallet and drain the treasury through the ordinary, signature-free
 * payroll path. There is no `require()` that closes this from inside the
 * covenant — the treasury and the vault have a circular naming dependency
 * (the vault needs the treasury's locking bytecode to exist first), so the
 * treasury cannot also pin the vault's address.
 *
 * The fix is procedural instead: mint every record directly to the vault's
 * locking bytecode, and — critically — never output a new minting-capability
 * NFT of this category. CashTokens minting authority can only be reduced,
 * never recreated once it is gone, so a transaction that spends the minting
 * UTXO without re-minting one destroys the category's minting authority
 * permanently. After this transaction confirms, no employment record of this
 * category can ever be created again by anyone, HR included — which is
 * exactly the guarantee `paySalary`'s trust-root comment already assumes.
 *
 * An earlier chipnet-script brief for this project described "the minting
 * baton returned to HR" after issuing a record. That is precisely the
 * mistake this function exists to prevent: keeping the baton alive means HR
 * (or anyone who steals HR's key) can mint a forged record at any time.
 *
 * If new hires must be enrollable after genesis, a baton covenant has to
 * constrain WHAT is minted — the commitment must be pre-committed by a
 * separate key or multisig, or co-signed by the employee — and not merely
 * where the NFT lands. An earlier draft of this comment recommended "a baton
 * inside a covenant that may only emit NFTs whose `lockingBytecode` equals
 * the vault". That does not work, and `genesis.test.ts`'s second CONTRAST
 * case proves it on the VM: a forged record minted straight into the vault
 * is paid exactly like a genuine one, because `EmploymentVault.payroll()`
 * checks only that input 0 is the treasury and `paySalary` reads the
 * commitment's salary and payee as truth. Sitting in the vault is an
 * address, not a credential.
 */
export function buildGenesisEmploymentTransaction(
  options: BuildGenesisEmploymentTransactionOptions,
): TransactionBuilder {
  const { provider, mintingUtxo, mintingSigner, vaultLockingBytecode, employees, changeAddress, feeRateSatsPerByte = 1 } =
    options;

  if (mintingUtxo.token?.nft?.capability !== 'minting') {
    throw new Error('buildGenesisEmploymentTransaction: mintingUtxo does not carry a minting-capability NFT');
  }
  if (employees.length === 0) {
    throw new Error('buildGenesisEmploymentTransaction: no employees to enrol');
  }

  const builder = new TransactionBuilder({ provider });

  builder.addInput(mintingUtxo, mintingSigner.unlockP2PKH());

  for (const employee of employees) {
    builder.addOutput({
      to: vaultLockingBytecode,
      amount: employee.satoshis ?? DEFAULT_NFT_DUST_SATOSHIS,
      token: {
        amount: 0n,
        category: mintingUtxo.token.category,
        nft: { capability: 'mutable', commitment: employee.commitmentHex },
      },
    });
  }

  // Deliberately no minting-capability output. This line is the entire fix:
  // its absence is what burns the baton.
  builder.addBchChangeOutputIfNeeded({ to: changeAddress, feeRate: feeRateSatsPerByte });

  return builder;
}
