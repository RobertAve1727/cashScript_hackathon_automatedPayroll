import { hexToBin } from '@bitauth/libauth';
import { SignatureTemplate, TransactionBuilder, type NetworkProvider, type Utxo } from 'cashscript';
import {
  commitmentFromHex,
  commitmentToHex,
  computeDeductions,
  decodeCommitment,
  encodeCommitment,
  outputLayoutFor,
} from '../../../domain/index.js';
import type { EmploymentVaultContract, PayrollTreasuryContract } from './addresses.js';
import { p2pkhLockingBytecode } from './p2pkh.js';

/** Dust floor for a fresh P2PKH token output — comfortably above the CashTokens minimum. */
const TOKEN_OUTPUT_DUST_SATOSHIS = 1_000n;

export interface RemitConfig {
  readonly sssPkh: Uint8Array;
  readonly phicPkh: Uint8Array;
  readonly hdmfPkh: Uint8Array;
  readonly birPkh: Uint8Array;
}

export interface BuildPaySalaryTransactionOptions {
  readonly provider: NetworkProvider;
  readonly treasury: PayrollTreasuryContract;
  readonly vault: EmploymentVaultContract;
  /** The treasury's current ePHP-holding UTXO. */
  readonly treasuryUtxo: Utxo;
  /** The employee's current Employment NFT UTXO, sitting in the vault. */
  readonly nftUtxo: Utxo;
  /** UTXOs that pay the transaction fee and every token output's dust. */
  readonly feeUtxos: readonly Utxo[];
  readonly feeSigner: SignatureTemplate;
  /** Where fee change (if any) returns to — an address or raw locking bytecode. */
  readonly feeChangeAddress: string | Uint8Array;
  readonly remitConfig: RemitConfig;
  readonly genesisTime: bigint;
  readonly periodSeconds: bigint;
  /**
   * Pay periods in a month, and it MUST be the value the treasury was deployed
   * with. The covenant recomputes every amount from it and rejects the
   * transaction if one centavo differs, so a mismatch here fails with "output 0
   * must be exactly net pay" rather than anything about cadence.
   */
  readonly periodsPerMonth?: bigint;
  readonly feeRateSatsPerByte?: number;
}

/**
 * Assemble one `paySalary` transaction end to end.
 *
 * This is the one place that turns "an employee is owed a payslip" into an
 * actual Bitcoin Cash transaction — everything upstream (statutory math,
 * commitment encoding, the output-index shift) is pure domain logic with no
 * chain awareness at all. This module is deliberately thin: it reads the
 * employee's current commitment, asks the domain for the deduction split and
 * the output layout, and places outputs in exactly the order the covenant
 * demands. No amount or recipient is decided here — they are all decided by
 * `computeDeductions` and the commitment, which is the whole point of a
 * permissionless covenant: whoever builds this transaction has no discretion.
 */
export function buildPaySalaryTransaction(options: BuildPaySalaryTransactionOptions): TransactionBuilder {
  const {
    provider,
    treasury,
    vault,
    treasuryUtxo,
    nftUtxo,
    feeUtxos,
    feeSigner,
    feeChangeAddress,
    remitConfig,
    genesisTime,
    periodSeconds,
  periodsPerMonth,
    feeRateSatsPerByte = 1,
  } = options;

  if (nftUtxo.token === undefined) {
    throw new Error('buildPaySalaryTransaction: nftUtxo carries no CashToken');
  }
  if (treasuryUtxo.token === undefined) {
    throw new Error('buildPaySalaryTransaction: treasuryUtxo carries no CashToken');
  }

  const commitment = decodeCommitment(commitmentFromHex(nftUtxo.token.nft?.commitment ?? ''));
  const deductions = computeDeductions({
    monthlyBasic: commitment.monthlyBasic,
    monthlyAllowance: commitment.monthlyAllowance,
    taxPerPeriod: commitment.taxPerPeriod,
    ...(periodsPerMonth === undefined ? {} : { periodsPerMonth }),
  });

  // The treasury must keep a strictly positive remainder. A zero-amount
  // CashToken output is invalid — the same rule that makes the BIR output
  // disappear when there is no tax (see `outputLayoutFor` below) — but here
  // it cannot be handled by dropping the output: the covenant requires the
  // treasury change at a fixed index. Worse, the failure is silent in the
  // wrong direction: libauth drops the whole token prefix when encoding a
  // zero-amount output, so `send()` would pass the local VM proof and the
  // broadcast bytes would then be rejected on chain. Catch it here, where the
  // message can say what to do about it.
  if (treasuryUtxo.token.amount <= deductions.totalDrawn) {
    throw new Error(
      `buildPaySalaryTransaction: the treasury holds ${treasuryUtxo.token.amount} ePHP units but this period draws ` +
        `${deductions.totalDrawn}; the covenant requires a strictly positive remainder, so top the treasury up ` +
        `(or use sweepLapsedNca to recover a final balance)`,
    );
  }
  const layout = outputLayoutFor(commitment.taxPerPeriod);

  const advancedCommitment = encodeCommitment({
    ...commitment,
    nextPeriod: commitment.nextPeriod + 1,
  });

  const builder = new TransactionBuilder({ provider });

  // Input 0: the treasury. The covenant pins `activeInputIndex == 0`, so this
  // must be added first.
  builder.addInput(
    treasuryUtxo,
    treasury.unlock.paySalary(remitConfig.sssPkh, remitConfig.phicPkh, remitConfig.hdmfPkh, remitConfig.birPkh),
  );

  // Input 1: the employment record. `EmploymentVault.payroll()` pins
  // `activeInputIndex == 1`, so this must be second.
  builder.addInput(nftUtxo, vault.unlock.payroll());

  // Input 2+: fee UTXOs. These fund every output's dust plus the mining fee;
  // the treasury and the NFT never lose satoshis to fund them (the covenant's
  // satoshi-floor checks require the opposite).
  builder.addInputs([...feeUtxos], feeSigner.unlockP2PKH());

  const pesoCategory = treasuryUtxo.token.category;

  builder.addOutput({
    to: p2pkhLockingBytecode(commitment.payeePkh),
    amount: TOKEN_OUTPUT_DUST_SATOSHIS,
    token: { amount: deductions.net, category: pesoCategory },
  });
  builder.addOutput({
    to: p2pkhLockingBytecode(remitConfig.sssPkh),
    amount: TOKEN_OUTPUT_DUST_SATOSHIS,
    token: { amount: deductions.sssTotal, category: pesoCategory },
  });
  builder.addOutput({
    to: p2pkhLockingBytecode(remitConfig.phicPkh),
    amount: TOKEN_OUTPUT_DUST_SATOSHIS,
    token: { amount: deductions.phicTotal, category: pesoCategory },
  });
  builder.addOutput({
    to: p2pkhLockingBytecode(remitConfig.hdmfPkh),
    amount: TOKEN_OUTPUT_DUST_SATOSHIS,
    token: { amount: deductions.hdmfTotal, category: pesoCategory },
  });

  // The BIR output is omitted entirely when there is no tax — a zero-amount
  // CashToken output is invalid, and the covenant shifts everything after it
  // up by one slot. `outputLayoutFor` is the single source of truth for the
  // resulting indices; nothing here hardcodes 4/5 vs 5/6.
  if (layout.bir !== null) {
    builder.addOutput({
      to: p2pkhLockingBytecode(remitConfig.birPkh),
      amount: TOKEN_OUTPUT_DUST_SATOSHIS,
      token: { amount: deductions.tax, category: pesoCategory },
    });
  }

  // The employment record, returned to the vault with only nextPeriod
  // advanced, keeping at least its original satoshis (the covenant's
  // satoshi-floor check on this output).
  builder.addOutput({
    to: hexToBin(vault.lockingBytecode),
    amount: nftUtxo.satoshis,
    token: {
      amount: 0n,
      category: nftUtxo.token.category,
      nft: { capability: 'mutable', commitment: commitmentToHex(advancedCommitment) },
    },
  });

  // The treasury, re-created with the exact ePHP remainder and at least its
  // original satoshis.
  // `totalDrawn` is that same five-way sum, computed once in the domain layer
  // — re-spelling it here is how the two drift apart.
  const treasuryChange = treasuryUtxo.token.amount - deductions.totalDrawn;

  builder.addOutput({
    to: hexToBin(treasury.lockingBytecode),
    amount: treasuryUtxo.satoshis,
    token: { amount: treasuryChange, category: pesoCategory },
  });

  builder.setLocktime(Number(genesisTime + BigInt(commitment.nextPeriod) * periodSeconds));

  builder.addBchChangeOutputIfNeeded({ to: feeChangeAddress, feeRate: feeRateSatsPerByte });

  return builder;
}
