/**
 * Minimal CashAddr decoder — just enough to turn the address Paytaca hands us
 * over WalletConnect into the 20-byte P2PKH hash the employment NFT carries.
 *
 * For a P2PKH cash address the payload IS the pubkey hash: after base32
 * decoding and checksum verification, byte 0 is the version byte
 * (type in bits 3–6, hash-size in bits 0–2) and the remaining 20 bytes are
 * hash160(pubkey). Token-aware addresses (bchtest:z…) differ only in the
 * type bits (2 instead of 0) — same hash, so we accept both.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const KNOWN_PREFIXES = ['bitcoincash', 'bchtest', 'bchreg'] as const;

/** BCH cashaddr checksum (BIP-173-style polymod over GF(2^5), 40-bit state). */
function polymod(values: readonly number[]): bigint {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    if (c0 & 0x01n) c ^= 0x98f2bc8e61n;
    if (c0 & 0x02n) c ^= 0x79b76d99e2n;
    if (c0 & 0x04n) c ^= 0xf33e5fb3c4n;
    if (c0 & 0x08n) c ^= 0xae2eabe2a8n;
    if (c0 & 0x10n) c ^= 0x1e4f43e470n;
  }
  return c ^ 1n;
}

function checksumValues(prefix: string, payload: readonly number[]): number[] {
  const prefixValues = [...prefix].map((ch) => ch.charCodeAt(0) & 0x1f);
  return [...prefixValues, 0, ...payload];
}

/** Regroup 5-bit values into bytes; rejects non-zero padding. */
function fiveToEight(values: readonly number[]): Uint8Array {
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const value of values) {
    acc = (acc << 5) | value;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  if (bits >= 5 || (acc & ((1 << bits) - 1)) !== 0) {
    throw new Error('Invalid cash address: bad payload padding.');
  }
  return Uint8Array.from(bytes);
}

export interface DecodedCashAddress {
  readonly prefix: string;
  /** Version-byte type bits: 0 = P2PKH, 1 = P2SH, 2 = P2PKH+tokens, 3 = P2SH+tokens. */
  readonly type: number;
  readonly hash: Uint8Array;
}

/** Decode any cash address (checksum-verified); throws on malformed input. */
export function decodeCashAddress(address: string): DecodedCashAddress {
  const lower = address.trim().toLowerCase();
  const colon = lower.indexOf(':');
  const candidates =
    colon >= 0 ? [lower.slice(0, colon)] : [...KNOWN_PREFIXES];
  const body = colon >= 0 ? lower.slice(colon + 1) : lower;

  const values: number[] = [];
  for (const ch of body) {
    const value = CHARSET.indexOf(ch);
    if (value < 0) throw new Error(`Invalid cash address character "${ch}".`);
    values.push(value);
  }
  if (values.length < 9) throw new Error('Invalid cash address: too short.');

  const prefix = candidates.find((p) => polymod(checksumValues(p, values)) === 0n);
  if (prefix === undefined) {
    throw new Error('Invalid cash address: checksum failed.');
  }

  const decoded = fiveToEight(values.slice(0, -8));
  const versionByte = decoded[0];
  if (versionByte === undefined) throw new Error('Invalid cash address: empty payload.');
  const hash = decoded.slice(1);
  const expectedSize = [20, 24, 28, 32, 40, 48, 56, 64][versionByte & 0x07];
  if (hash.length !== expectedSize) {
    throw new Error('Invalid cash address: hash length mismatch.');
  }

  return { prefix, type: (versionByte >> 3) & 0x0f, hash };
}

/**
 * The eSahod-specific question: what 20-byte payee PKH does this address pin?
 * Accepts plain (q…) and token-aware (z…) P2PKH forms; rejects P2SH.
 */
export function cashAddressToPkh(address: string): Uint8Array {
  const { type, hash } = decodeCashAddress(address);
  if ((type !== 0 && type !== 2) || hash.length !== 20) {
    throw new Error('Address is not P2PKH — cannot derive a payee PKH.');
  }
  return hash;
}
