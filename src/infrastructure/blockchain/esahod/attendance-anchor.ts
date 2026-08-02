import { binToHex } from '@bitauth/libauth';
import { TransactionBuilder, type NetworkProvider, type SignatureTemplate, type Utxo } from 'cashscript';
import { ANCHOR_BYTES, encodePunch, type Punch } from '../../../domain/attendance/time-record.js';

/**
 * Putting a clock-in on chain, at the moment it happens.
 *
 * The punch is written as an OP_RETURN output. That choice is deliberate and
 * worth defending:
 *
 * - An OP_RETURN output is provably unspendable, so it adds nothing to the
 *   UTXO set that anyone has to carry forever. Attendance is a log, not money,
 *   and encoding it as money would be the wrong shape.
 * - It is timestamped by the block that confirms it. The employer keeps the
 *   HRIS, but no longer owns the only copy of when the employee arrived.
 * - It needs no new covenant. Anchoring is a plain transaction any wallet can
 *   broadcast, which means the feature ships without touching the 284-opcode
 *   treasury that is already proven.
 *
 * ── WHAT THIS DOES AND DOES NOT GUARANTEE ───────────────────────────────
 *
 * It guarantees the record is TAMPER-EVIDENT: a punch, once confirmed, cannot
 * be edited or backdated, and its absence is as visible as its presence.
 *
 * It does not guarantee the punch is HONEST. Whoever holds the broadcasting
 * key can anchor a punch for a day nobody worked, and nothing in a block can
 * tell the difference. Making the payout itself conditional on attendance
 * would need the covenant to read an attendance record, which needs a second
 * covenant and commitment bytes the 40-byte employment record does not have.
 * That is a real design boundary, and it is stated here rather than implied
 * away — see the README's trust-model section.
 */

export interface BuildAttendanceAnchorOptions {
  readonly provider: NetworkProvider;
  readonly punch: Punch;
  /** Coins funding the fee. The anchor output itself carries zero satoshis. */
  readonly fundingUtxos: readonly Utxo[];
  readonly signer: SignatureTemplate;
  /** Where the change goes — the punching employee's own wallet, normally. */
  readonly changeLockingBytecode: Uint8Array;
  readonly feeRateSatsPerByte?: number;
}

/**
 * Build the anchoring transaction. One OP_RETURN, one change output.
 *
 * `addOpReturnOutput` prepends OP_RETURN itself, so the 13 bytes handed over
 * are exactly what a block explorer will show after the `6a` opcode. The
 * payload goes in `0x`-prefixed: cashscript hex-decodes a chunk that starts
 * with `0x` and UTF-8-encodes one that does not, and these are bytes rather
 * than text.
 */
export function buildAttendanceAnchorTransaction(
  options: BuildAttendanceAnchorOptions,
): TransactionBuilder {
  const { provider, punch, fundingUtxos, signer, changeLockingBytecode, feeRateSatsPerByte = 1 } = options;

  if (fundingUtxos.length === 0) {
    throw new Error('buildAttendanceAnchorTransaction: no funding UTXO to pay the anchor fee');
  }

  const payload = encodePunch(punch);
  if (payload.length !== ANCHOR_BYTES) {
    throw new Error(
      `buildAttendanceAnchorTransaction: anchor payload must be ${ANCHOR_BYTES} bytes, got ${payload.length}`,
    );
  }

  const builder = new TransactionBuilder({ provider });

  builder.addInputs([...fundingUtxos], signer.unlockP2PKH());
  builder.addOpReturnOutput([`0x${binToHex(payload)}`]);
  builder.addBchChangeOutputIfNeeded({ to: changeLockingBytecode, feeRate: feeRateSatsPerByte });

  return builder;
}
