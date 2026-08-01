import { InvariantViolationError } from '../errors/invariant-violation.error.js';
import {
  COMMITMENT_BYTES,
  COMMITMENT_LAYOUT,
  EMPLOYMENT_STATUS_ACTIVE,
  EMPLOYMENT_STATUS_INACTIVE,
  type FixtureEmployee,
} from './types.js';

/**
 * The 40-byte employment commitment codec — backlog tasks T05 and T06.
 *
 * This file is the only place in the repo that turns an employment record into
 * bytes, and it is the seam where an off-by-one is invisible until a covenant
 * rejects a transaction with no explanation. The layout it serialises is
 * declared once, in `COMMITMENT_LAYOUT`; every offset below is read from there
 * rather than written out again, so the two can never drift apart.
 *
 * ══ WHY LITTLE-ENDIAN, AND WHY THE TOP BIT IS OFF LIMITS ════════════════
 *
 * The covenant reads these fields with CashScript's `int()` cast, which decodes
 * a Bitcoin Script number: little-endian, with the most significant bit of the
 * final byte acting as a SIGN flag. A 4-byte field holding `0x80000000` is not
 * 2,147,483,648 to the VM — it is negative zero. A salary that big would
 * silently become a negative salary on chain.
 *
 * So the codec enforces one rule uniformly: every numeric field must be
 * non-negative and strictly below `2^(8 * width - 1)`, which is exactly "the
 * sign bit stays clear". That gives < 2^31 for the 4-byte money fields
 * (₱21,474,836.47 per month — comfortably above any real payroll), < 2^15 for
 * the 2-byte period counters, and < 2^23 for the 3-byte employee number.
 * Inside that range the plain unsigned little-endian encoding written here and
 * the VM's signed reading agree byte for byte, by construction.
 *
 * `decodeCommitment` applies the same sign-bit checks to the numeric fields,
 * with two deliberate asymmetries against `encodeCommitment`:
 *
 *   - The STATUS byte is returned raw, whatever it is. A reader walking the
 *     whole payroll must be able to decode one malformed record and keep
 *     going; only `encodeCommitment` insists on 0 or 1, so this codec can
 *     never MINT a record the covenant misreads, while still being able to
 *     READ anything already on chain.
 *   - Encode additionally caps both period fields at `MAX_ENCODABLE_PERIOD`
 *     (32766, one below the 2-byte sign-bit limit). The covenant advances a
 *     paid record by writing `period + 1` back into the same two signed
 *     bytes; a record minted at 32767 could never be advanced — its
 *     `toPaddedBytes(32768, 2)` does not fit — so paySalary would fail
 *     forever and the record would be permanently unpayable. Decode still
 *     accepts 32767, because reading such a record is how you find out it
 *     needs fixing.
 *
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Domain layer: no npm package, no `node:` builtin, no `Buffer`. Just
 * `Uint8Array` and arithmetic, which is what lets the payroll rules run
 * unchanged in a browser, in a test, or inside the CLI.
 */

const SUBJECT = 'EmploymentCommitment';

/** One field's position in the 40-byte record. */
interface CommitmentField {
  readonly offset: number;
  readonly bytes: number;
}

/** `0` = suspended or separated, `1` = active. The covenant refuses to pay `0`. */
export type EmploymentStatusCode =
  | typeof EMPLOYMENT_STATUS_ACTIVE
  | typeof EMPLOYMENT_STATUS_INACTIVE;

/**
 * The decoded employment record — the digital form of the employment contract.
 *
 * Money is `bigint` centavos, as it is everywhere else in the domain. Counters
 * and identifiers are plain `number`s: they are ordinals, never arithmetic
 * operands against money.
 */
export interface EmploymentCommitment {
  /** The employee's P2PKH hash, exactly 20 bytes. */
  readonly payeePkh: Uint8Array;
  /** Monthly basic salary, centavos. Base for PhilHealth. */
  readonly monthlyBasic: bigint;
  /** Monthly allowances forming part of compensation, centavos. */
  readonly monthlyAllowance: bigint;
  /** Withholding tax per cut-off, centavos. HR computes it; the chain enforces it. */
  readonly taxPerPeriod: bigint;
  /** The next period this employee may be paid for. The anti-double-payment counter. */
  readonly nextPeriod: number;
  /** Last payable period — fixed-term contracts expire without anyone intervening. */
  readonly endPeriod: number;
  /**
   * Raw status byte. `encodeCommitment` accepts only the two documented
   * values — 1 active, 0 suspended/separated (`EmploymentStatusCode`) —
   * but `decodeCommitment` hands back whatever byte is on chain, so one
   * malformed record cannot crash a reader walking the whole payroll.
   */
  readonly status: number;
  /** Company employee number, for the audit trail. */
  readonly employeeNo: number;
}

// ── Field-level rules ────────────────────────────────────────────────────

/**
 * First value a field of this width can NOT hold: `2^(8w - 1)`.
 *
 * The `- 1` is the Script sign bit, not an off-by-one. See the file header.
 */
function exclusiveLimit(field: CommitmentField): bigint {
  return 1n << (BigInt(field.bytes) * 8n - 1n);
}

/** Range-check a centavo amount against the width it has to fit in. */
function checkedAmount(name: string, value: bigint, field: CommitmentField): bigint {
  if (typeof value !== 'bigint') {
    throw new InvariantViolationError(
      SUBJECT,
      `${name} must be a bigint of centavos, got ${typeof value} (${String(value)})`,
    );
  }
  if (value < 0n) {
    throw new InvariantViolationError(SUBJECT, `${name} must not be negative, got ${value}`);
  }

  const limit = exclusiveLimit(field);
  if (value >= limit) {
    throw new InvariantViolationError(
      SUBJECT,
      `${name} must be less than ${limit} to fit ${field.bytes} bytes as a signed little-endian Script number, got ${value}`,
    );
  }

  return value;
}

/** Range-check a counter or identifier held as a `number`. */
function checkedCount(name: string, value: number, field: CommitmentField): bigint {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new InvariantViolationError(SUBJECT, `${name} must be a whole number, got ${String(value)}`);
  }

  return checkedAmount(name, BigInt(value), field);
}

/**
 * Largest period value `encodeCommitment` accepts: one BELOW the 2-byte
 * sign-bit limit of 32767.
 *
 * The covenant marks a period paid by rewriting `nextPeriod` to `period + 1`
 * inside the same two signed bytes. A record minted at 32767 could never be
 * advanced — 32768 does not fit — so `paySalary` would fail forever and the
 * record would be permanently unpayable. Refusing 32767 at the mint costs
 * nothing: 32766 semi-monthly periods is over 1,300 years of payroll.
 */
export const MAX_ENCODABLE_PERIOD = 32766;

/** Range-check a period counter, leaving headroom for the covenant's `+ 1`. */
function checkedPeriod(name: string, value: number, field: CommitmentField): bigint {
  const checked = checkedCount(name, value, field);

  if (checked > BigInt(MAX_ENCODABLE_PERIOD)) {
    throw new InvariantViolationError(
      SUBJECT,
      `${name} must be at most ${MAX_ENCODABLE_PERIOD} so the covenant can still write period + 1 into 2 signed bytes, got ${value}`,
    );
  }

  return checked;
}

// ── Byte-level primitives ────────────────────────────────────────────────

/** Write `value` little-endian into exactly `field.bytes` bytes at `field.offset`. */
function writeLittleEndian(target: Uint8Array, field: CommitmentField, value: bigint): void {
  let remaining = value;
  for (let index = 0; index < field.bytes; index += 1) {
    target[field.offset + index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
}

/** Read `field.bytes` little-endian bytes at `field.offset` back into a `bigint`. */
function readLittleEndian(source: Uint8Array, field: CommitmentField): bigint {
  let value = 0n;
  for (let index = field.bytes - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(source[field.offset + index] ?? 0);
  }

  return value;
}

// ── The codec ────────────────────────────────────────────────────────────

/**
 * Serialise an employment record to the exact 40 bytes the NFT commitment
 * carries.
 *
 * @throws InvariantViolationError if any field cannot be represented on chain.
 */
export function encodeCommitment(record: EmploymentCommitment): Uint8Array {
  const bytes = new Uint8Array(COMMITMENT_BYTES);

  const { payeePkh } = record;
  if (!(payeePkh instanceof Uint8Array)) {
    throw new InvariantViolationError(SUBJECT, 'payeePkh must be a Uint8Array');
  }
  if (payeePkh.length !== COMMITMENT_LAYOUT.payeePkh.bytes) {
    throw new InvariantViolationError(
      SUBJECT,
      `payeePkh must be exactly ${COMMITMENT_LAYOUT.payeePkh.bytes} bytes, got ${payeePkh.length}`,
    );
  }
  bytes.set(payeePkh, COMMITMENT_LAYOUT.payeePkh.offset);

  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.monthlyBasic,
    checkedAmount('monthlyBasic', record.monthlyBasic, COMMITMENT_LAYOUT.monthlyBasic),
  );
  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.monthlyAllowance,
    checkedAmount('monthlyAllowance', record.monthlyAllowance, COMMITMENT_LAYOUT.monthlyAllowance),
  );
  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.taxPerPeriod,
    checkedAmount('taxPerPeriod', record.taxPerPeriod, COMMITMENT_LAYOUT.taxPerPeriod),
  );
  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.nextPeriod,
    checkedPeriod('nextPeriod', record.nextPeriod, COMMITMENT_LAYOUT.nextPeriod),
  );
  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.endPeriod,
    checkedPeriod('endPeriod', record.endPeriod, COMMITMENT_LAYOUT.endPeriod),
  );
  writeLittleEndian(bytes, COMMITMENT_LAYOUT.status, BigInt(checkedStatus(record.status)));
  writeLittleEndian(
    bytes,
    COMMITMENT_LAYOUT.employeeNo,
    checkedCount('employeeNo', record.employeeNo, COMMITMENT_LAYOUT.employeeNo),
  );

  return bytes;
}

/**
 * Read the 40 bytes back. The `payeePkh` is copied, never aliased, so a decoded
 * record cannot be mutated from underneath by whoever still holds the buffer.
 *
 * The status byte comes back RAW — see the file header. Numeric fields are
 * still refused when their sign bit is set, because the VM would read those as
 * negative and no honest encoder can have produced them.
 *
 * @throws InvariantViolationError if the length is wrong or a numeric field
 *   has its Script sign bit set.
 */
export function decodeCommitment(bytes: Uint8Array): EmploymentCommitment {
  if (!(bytes instanceof Uint8Array)) {
    throw new InvariantViolationError(SUBJECT, 'a commitment must be a Uint8Array');
  }
  if (bytes.length !== COMMITMENT_BYTES) {
    throw new InvariantViolationError(
      SUBJECT,
      `a commitment is exactly ${COMMITMENT_BYTES} bytes, got ${bytes.length}`,
    );
  }

  const payeePkh = bytes.slice(
    COMMITMENT_LAYOUT.payeePkh.offset,
    COMMITMENT_LAYOUT.payeePkh.offset + COMMITMENT_LAYOUT.payeePkh.bytes,
  );

  return {
    payeePkh,
    monthlyBasic: checkedAmount(
      'monthlyBasic',
      readLittleEndian(bytes, COMMITMENT_LAYOUT.monthlyBasic),
      COMMITMENT_LAYOUT.monthlyBasic,
    ),
    monthlyAllowance: checkedAmount(
      'monthlyAllowance',
      readLittleEndian(bytes, COMMITMENT_LAYOUT.monthlyAllowance),
      COMMITMENT_LAYOUT.monthlyAllowance,
    ),
    taxPerPeriod: checkedAmount(
      'taxPerPeriod',
      readLittleEndian(bytes, COMMITMENT_LAYOUT.taxPerPeriod),
      COMMITMENT_LAYOUT.taxPerPeriod,
    ),
    nextPeriod: Number(
      checkedAmount(
        'nextPeriod',
        readLittleEndian(bytes, COMMITMENT_LAYOUT.nextPeriod),
        COMMITMENT_LAYOUT.nextPeriod,
      ),
    ),
    endPeriod: Number(
      checkedAmount(
        'endPeriod',
        readLittleEndian(bytes, COMMITMENT_LAYOUT.endPeriod),
        COMMITMENT_LAYOUT.endPeriod,
      ),
    ),
    // Deliberately unvalidated: decode returns the raw byte so one malformed
    // record cannot crash an off-chain reader walking the whole payroll. The
    // 0/1 rule is enforced on encode alone (and by the covenant, which
    // refuses to pay any status other than 1).
    status: Number(readLittleEndian(bytes, COMMITMENT_LAYOUT.status)),
    employeeNo: Number(
      checkedAmount(
        'employeeNo',
        readLittleEndian(bytes, COMMITMENT_LAYOUT.employeeNo),
        COMMITMENT_LAYOUT.employeeNo,
      ),
    ),
  };
}

/** The status byte is a flag, not a number — only the two documented values exist. */
function checkedStatus(value: number): EmploymentStatusCode {
  if (value !== EMPLOYMENT_STATUS_ACTIVE && value !== EMPLOYMENT_STATUS_INACTIVE) {
    throw new InvariantViolationError(
      SUBJECT,
      `status must be ${EMPLOYMENT_STATUS_ACTIVE} (active) or ${EMPLOYMENT_STATUS_INACTIVE} (inactive), got ${String(value)}`,
    );
  }

  return value;
}

// ── Convenience ──────────────────────────────────────────────────────────

/** The parts of an employment record that the salary fixture does not carry. */
export interface EmploymentTerms {
  /** The employee's P2PKH hash, exactly 20 bytes. */
  readonly payeePkh: Uint8Array;
  /** First period this NFT may be paid for. */
  readonly nextPeriod: number;
  /** Last payable period. */
  readonly endPeriod: number;
  /** Defaults to active. */
  readonly status?: EmploymentStatusCode;
}

/**
 * Build a commitment record from one of the fixture employees plus the terms
 * that live outside the salary maths — the wallet being paid and the window
 * the contract runs for.
 */
export function commitmentForEmployee(
  employee: FixtureEmployee,
  terms: EmploymentTerms,
): EmploymentCommitment {
  return {
    payeePkh: terms.payeePkh,
    monthlyBasic: employee.monthlyBasic,
    monthlyAllowance: employee.monthlyAllowance,
    taxPerPeriod: employee.taxPerPeriod,
    nextPeriod: terms.nextPeriod,
    endPeriod: terms.endPeriod,
    status: terms.status ?? EMPLOYMENT_STATUS_ACTIVE,
    employeeNo: employee.employeeNo,
  };
}

/** Lowercase hex, the form the CashScript SDK wants an NFT commitment in. */
export function commitmentToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }

  return hex;
}

/** Parse hex back into bytes. Accepts any even-length hex, case-insensitive. */
export function commitmentFromHex(hex: string): Uint8Array {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) {
    throw new InvariantViolationError(SUBJECT, `"${String(hex)}" is not an even-length hex string`);
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}
