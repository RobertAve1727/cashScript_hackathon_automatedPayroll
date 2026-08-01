/**
 * Build a P2PKH locking script directly from a 20-byte hash160.
 *
 * The covenant's remittance recipients (SSS, PhilHealth, Pag-IBIG, BIR) are
 * known only as `bytes20` hashes, not public keys, so
 * `publicKeyToP2PKHLockingBytecode` (which needs a pubkey) does not apply.
 * `OP_DUP OP_HASH160 <20 bytes> OP_EQUALVERIFY OP_CHECKSIG` is five bytes of
 * fixed opcodes around the hash — trivial to construct directly, and it lets
 * `TransactionBuilder.addOutput` take the locking bytecode as `Uint8Array`
 * without needing a token-aware CashAddress for every remittance address.
 */
export function p2pkhLockingBytecode(pkh: Uint8Array): Uint8Array {
  if (pkh.length !== 20) {
    throw new Error(`p2pkhLockingBytecode: expected a 20-byte hash160, got ${pkh.length} bytes`);
  }

  return Uint8Array.from([0x76, 0xa9, 0x14, ...pkh, 0x88, 0xac]);
}
