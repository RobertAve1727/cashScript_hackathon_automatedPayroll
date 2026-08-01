import { describe, expect, it } from 'vitest';
import {
  commitmentForEmployee,
  commitmentFromHex,
  commitmentToHex,
  decodeCommitment,
  encodeCommitment,
  MAX_ENCODABLE_PERIOD,
  type EmploymentCommitment,
  type EmploymentStatusCode,
} from '../../src/domain/payroll/commitment.js';
import {
  COMMITMENT_BYTES,
  COMMITMENT_LAYOUT,
  EMPLOYMENT_STATUS_ACTIVE,
  EMPLOYMENT_STATUS_INACTIVE,
  FIXTURES,
  FIXTURE_ANALYST,
  FIXTURE_ENTRY_LEVEL,
} from '../../src/domain/payroll/types.js';
import { InvariantViolationError } from '../../src/domain/errors/invariant-violation.error.js';

/**
 * Real P2PKH hashes, taken from the CashAddresses in `tests/support/addresses.ts`.
 *
 * Alice's begins with `0x8e` on purpose: a byte with its high bit set, which
 * catches any accidental sign handling in the hash region, where bytes are raw
 * and must never be interpreted as a number.
 */
const ALICE_PKH = commitmentFromHex('8e5e102cb0c472b15486dc977ce7706c3211cc2b');
const BOB_PKH = commitmentFromHex('fd8c18100707eebe8772863179065994115515a2');

const ANALYST_COMMITMENT = commitmentForEmployee(FIXTURE_ANALYST, {
  payeePkh: ALICE_PKH,
  nextPeriod: 1,
  endPeriod: 24,
});

const ENTRY_LEVEL_COMMITMENT = commitmentForEmployee(FIXTURE_ENTRY_LEVEL, {
  payeePkh: BOB_PKH,
  nextPeriod: 7,
  endPeriod: 260, // > 255, so it cannot fit in one byte — the 2-byte width matters
});

/** Read one field's slice as hex, using the offsets `types.ts` declares. */
const fieldHex = (bytes: Uint8Array, field: { offset: number; bytes: number }): string =>
  commitmentToHex(bytes.slice(field.offset, field.offset + field.bytes));

/** A valid record to mutate one field of at a time. */
const validRecord = (): EmploymentCommitment => ({ ...ANALYST_COMMITMENT });

describe('the 40-byte employment commitment codec', () => {
  describe('round trip — T06', () => {
    it.each([
      ['fixture A, Systems Analyst', ANALYST_COMMITMENT],
      ['fixture B, Warehouse Associate', ENTRY_LEVEL_COMMITMENT],
    ])('%s survives encode then decode unchanged', (_case, record) => {
      expect(decodeCommitment(encodeCommitment(record))).toEqual(record);
    });

    it('re-encodes a decoded record to the identical bytes', () => {
      for (const record of [ANALYST_COMMITMENT, ENTRY_LEVEL_COMMITMENT]) {
        const bytes = encodeCommitment(record);

        expect(encodeCommitment(decodeCommitment(bytes))).toEqual(bytes);
      }
    });

    it('carries every fixture employee through without touching the salary maths', () => {
      for (const fixture of FIXTURES) {
        const record = commitmentForEmployee(fixture, {
          payeePkh: ALICE_PKH,
          nextPeriod: 1,
          endPeriod: 26,
        });
        const decoded = decodeCommitment(encodeCommitment(record));

        expect(decoded.monthlyBasic).toBe(fixture.monthlyBasic);
        expect(decoded.monthlyAllowance).toBe(fixture.monthlyAllowance);
        expect(decoded.taxPerPeriod).toBe(fixture.taxPerPeriod);
        expect(decoded.employeeNo).toBe(fixture.employeeNo);
      }
    });

    it('defaults a new employment to active, and honours an explicit status', () => {
      expect(commitmentForEmployee(FIXTURE_ANALYST, { payeePkh: ALICE_PKH, nextPeriod: 1, endPeriod: 24 }).status).toBe(
        EMPLOYMENT_STATUS_ACTIVE,
      );

      const suspended = commitmentForEmployee(FIXTURE_ANALYST, {
        payeePkh: ALICE_PKH,
        nextPeriod: 1,
        endPeriod: 24,
        status: EMPLOYMENT_STATUS_INACTIVE,
      });

      expect(decodeCommitment(encodeCommitment(suspended)).status).toBe(EMPLOYMENT_STATUS_INACTIVE);
    });
  });

  describe('size', () => {
    it('is exactly 40 bytes — the CashTokens commitment limit', () => {
      expect(COMMITMENT_BYTES).toBe(40);

      for (const record of [ANALYST_COMMITMENT, ENTRY_LEVEL_COMMITMENT]) {
        expect(encodeCommitment(record)).toHaveLength(40);
      }
    });

    it('is exactly what the declared layout adds up to — no spare bytes, no overlap', () => {
      const fields = Object.values(COMMITMENT_LAYOUT);
      const total = fields.reduce((sum, field) => sum + field.bytes, 0);
      const ordered = [...fields].sort((a, b) => a.offset - b.offset);

      expect(total).toBe(COMMITMENT_BYTES);

      let expectedOffset = 0;
      for (const field of ordered) {
        expect(field.offset).toBe(expectedOffset);
        expectedOffset += field.bytes;
      }
    });

    it('returns a fresh buffer each time, so a caller cannot corrupt the next one', () => {
      const first = encodeCommitment(ANALYST_COMMITMENT);
      first[0] = 0xff;

      expect(encodeCommitment(ANALYST_COMMITMENT)[0]).toBe(ALICE_PKH[0]);
    });

    it('copies the payee hash on decode rather than aliasing the input buffer', () => {
      const bytes = encodeCommitment(ANALYST_COMMITMENT);
      const decoded = decodeCommitment(bytes);
      bytes[0] = 0xff;

      expect(decoded.payeePkh[0]).toBe(ALICE_PKH[0]);
    });
  });

  describe('byte offsets — every field lands exactly where types.ts says', () => {
    const bytes = encodeCommitment(ANALYST_COMMITMENT);

    it('puts the payee hash in [0:20], verbatim', () => {
      expect(COMMITMENT_LAYOUT.payeePkh).toEqual({ offset: 0, bytes: 20 });
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.payeePkh)).toBe('8e5e102cb0c472b15486dc977ce7706c3211cc2b');
    });

    it.each([
      ['monthlyBasic', COMMITMENT_LAYOUT.monthlyBasic, { offset: 20, bytes: 4 }, 'e0673500'], // ₱35,000.00
      ['monthlyAllowance', COMMITMENT_LAYOUT.monthlyAllowance, { offset: 24, bytes: 4 }, '400d0300'], // ₱2,000.00
      ['taxPerPeriod', COMMITMENT_LAYOUT.taxPerPeriod, { offset: 28, bytes: 4 }, '108f0100'], // ₱1,021.60
      ['nextPeriod', COMMITMENT_LAYOUT.nextPeriod, { offset: 32, bytes: 2 }, '0100'],
      ['endPeriod', COMMITMENT_LAYOUT.endPeriod, { offset: 34, bytes: 2 }, '1800'], // period 24
      ['status', COMMITMENT_LAYOUT.status, { offset: 36, bytes: 1 }, '01'], // active
      ['employeeNo', COMMITMENT_LAYOUT.employeeNo, { offset: 37, bytes: 3 }, 'e90300'], // 1001
    ])('writes %s at the declared offset', (_name, field, expectedPosition, expectedHex) => {
      expect(field).toEqual(expectedPosition);
      expect(fieldHex(bytes, field)).toBe(expectedHex);
    });

    it('never lets one field bleed into the next', () => {
      // Every numeric field at its maximum, so any overflow would be visible in
      // a neighbour rather than silently absorbed by a zero byte. The periods
      // saturate at 32766, not 32767 — encode keeps one step of headroom so
      // the covenant can always write period + 1 into the same two bytes.
      const saturated = encodeCommitment({
        payeePkh: new Uint8Array(20).fill(0xff),
        monthlyBasic: 2n ** 31n - 1n,
        monthlyAllowance: 2n ** 31n - 1n,
        taxPerPeriod: 2n ** 31n - 1n,
        nextPeriod: MAX_ENCODABLE_PERIOD,
        endPeriod: MAX_ENCODABLE_PERIOD,
        status: EMPLOYMENT_STATUS_ACTIVE,
        employeeNo: 2 ** 23 - 1,
      });

      expect(commitmentToHex(saturated)).toBe(
        'ffffffffffffffffffffffffffffffffffffffff' + // payeePkh
          'ffffff7f' + // monthlyBasic  2^31-1
          'ffffff7f' + // monthlyAllowance
          'ffffff7f' + // taxPerPeriod
          'fe7f' + // nextPeriod  32766
          'fe7f' + // endPeriod
          '01' + // status
          'ffff7f', // employeeNo  2^23-1
      );
    });
  });

  describe('little-endian, proved without relying on the round trip', () => {
    // A big-endian codec round-trips perfectly too — it just disagrees with
    // every `int()` cast in the covenant. These assertions pin the byte order
    // itself, using values whose two encodings cannot be confused.
    const record: EmploymentCommitment = {
      payeePkh: new Uint8Array(20),
      monthlyBasic: 0x04030201n, // 67,305,985 — all four bytes distinct
      monthlyAllowance: 1n,
      taxPerPeriod: 0x0000ff00n, // the only set byte is the second one
      nextPeriod: 0x0102, // 258
      endPeriod: 1,
      status: EMPLOYMENT_STATUS_ACTIVE,
      employeeNo: 0x030201, // 197,121
    };
    const bytes = encodeCommitment(record);

    it('writes the least significant byte of a 4-byte field first', () => {
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.monthlyBasic)).toBe('01020304');
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.monthlyBasic)).not.toBe('04030201'); // big-endian
    });

    it('writes the least significant byte of a 2-byte field first', () => {
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.nextPeriod)).toBe('0201');
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.nextPeriod)).not.toBe('0102'); // big-endian
    });

    it('writes the least significant byte of the 3-byte employee number first', () => {
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.employeeNo)).toBe('010203');
    });

    it('puts a value of 1 in the first byte of its field and leaves the rest zero', () => {
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.monthlyAllowance)).toBe('01000000');
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.endPeriod)).toBe('0100');
    });

    it('places an interior byte where little-endian says it goes', () => {
      // 0x0000ff00 is 65,280. Little-endian puts 0xff at index 1 of the field;
      // big-endian would put it at index 2.
      expect(fieldHex(bytes, COMMITMENT_LAYOUT.taxPerPeriod)).toBe('00ff0000');
    });

    it('decodes a hand-written little-endian field the same way', () => {
      const raw = encodeCommitment(validRecord());
      raw.set([0x00, 0x01, 0x00, 0x00], COMMITMENT_LAYOUT.monthlyBasic.offset); // 256, not 65,536

      expect(decodeCommitment(raw).monthlyBasic).toBe(256n);
    });
  });

  describe('boundary values', () => {
    const at = (overrides: Partial<EmploymentCommitment>): EmploymentCommitment => ({
      ...validRecord(),
      ...overrides,
    });

    it.each<[string, Partial<EmploymentCommitment>]>([
      ['zero salary', { monthlyBasic: 0n, monthlyAllowance: 0n, taxPerPeriod: 0n }],
      ['the largest 4-byte amount', { monthlyBasic: 2n ** 31n - 1n }],
      ['the largest 4-byte allowance', { monthlyAllowance: 2n ** 31n - 1n }],
      ['the largest 4-byte tax', { taxPerPeriod: 2n ** 31n - 1n }],
      ['period zero', { nextPeriod: 0, endPeriod: 0 }],
      ['the largest encodable period', { nextPeriod: MAX_ENCODABLE_PERIOD, endPeriod: MAX_ENCODABLE_PERIOD }],
      ['employee number zero', { employeeNo: 0 }],
      ['the largest 3-byte employee number', { employeeNo: 2 ** 23 - 1 }],
      ['an inactive employment', { status: EMPLOYMENT_STATUS_INACTIVE }],
      ['an all-zero payee hash', { payeePkh: new Uint8Array(20) }],
      ['an all-ones payee hash', { payeePkh: new Uint8Array(20).fill(0xff) }],
    ])('accepts %s and round-trips it', (_case, overrides) => {
      const record = at(overrides);

      expect(decodeCommitment(encodeCommitment(record))).toEqual(record);
    });

    it('draws the line exactly at the Script sign bit, not one either side', () => {
      expect(() => encodeCommitment(at({ monthlyBasic: 2n ** 31n - 1n }))).not.toThrow();
      expect(() => encodeCommitment(at({ monthlyBasic: 2n ** 31n }))).toThrow(InvariantViolationError);

      expect(() => encodeCommitment(at({ employeeNo: 2 ** 23 - 1 }))).not.toThrow();
      expect(() => encodeCommitment(at({ employeeNo: 2 ** 23 }))).toThrow(InvariantViolationError);
    });

    it('draws the period line one step BELOW the sign bit, so the covenant can always advance', () => {
      // 32767 fits two signed bytes, but 32767 + 1 does not — a record minted
      // there could never be paid, because paySalary must write period + 1.
      expect(MAX_ENCODABLE_PERIOD).toBe(2 ** 15 - 2);

      expect(() => encodeCommitment(at({ nextPeriod: MAX_ENCODABLE_PERIOD }))).not.toThrow();
      expect(() => encodeCommitment(at({ nextPeriod: 2 ** 15 - 1 }))).toThrow(InvariantViolationError);
      expect(() => encodeCommitment(at({ nextPeriod: 2 ** 15 }))).toThrow(InvariantViolationError);

      expect(() => encodeCommitment(at({ endPeriod: MAX_ENCODABLE_PERIOD }))).not.toThrow();
      expect(() => encodeCommitment(at({ endPeriod: 2 ** 15 - 1 }))).toThrow(InvariantViolationError);
    });

    it('keeps the top bit of every numeric field clear, so the VM reads it as positive', () => {
      const bytes = encodeCommitment(
        at({ monthlyBasic: 2n ** 31n - 1n, nextPeriod: MAX_ENCODABLE_PERIOD, employeeNo: 2 ** 23 - 1 }),
      );

      // The last byte of each field is the sign byte in a Script number.
      expect(bytes[COMMITMENT_LAYOUT.monthlyBasic.offset + 3]! & 0x80).toBe(0);
      expect(bytes[COMMITMENT_LAYOUT.nextPeriod.offset + 1]! & 0x80).toBe(0);
      expect(bytes[COMMITMENT_LAYOUT.employeeNo.offset + 2]! & 0x80).toBe(0);
    });
  });

  describe('encode rejects anything the chain could not represent', () => {
    const attempt = (overrides: Partial<Record<keyof EmploymentCommitment, unknown>>): (() => Uint8Array) => {
      const record = { ...validRecord(), ...overrides } as unknown as EmploymentCommitment;

      return () => encodeCommitment(record);
    };

    it.each([
      ['a payee hash one byte short', { payeePkh: new Uint8Array(19) }, /payeePkh/],
      ['a payee hash one byte long', { payeePkh: new Uint8Array(21) }, /payeePkh/],
      ['an empty payee hash', { payeePkh: new Uint8Array(0) }, /payeePkh/],
      ['a payee hash that is not bytes', { payeePkh: '8e5e102cb0c472b15486dc977ce7706c3211cc2b' }, /payeePkh/],
      ['a missing payee hash', { payeePkh: undefined }, /payeePkh/],
      ['a negative basic salary', { monthlyBasic: -1n }, /monthlyBasic.*negative/],
      ['a basic salary at the sign bit', { monthlyBasic: 2n ** 31n }, /monthlyBasic/],
      ['a wildly oversized basic salary', { monthlyBasic: 2n ** 64n }, /monthlyBasic/],
      ['a negative allowance', { monthlyAllowance: -1n }, /monthlyAllowance/],
      ['an oversized allowance', { monthlyAllowance: 2n ** 31n }, /monthlyAllowance/],
      ['a negative tax', { taxPerPeriod: -1n }, /taxPerPeriod/],
      ['an oversized tax', { taxPerPeriod: 2n ** 31n }, /taxPerPeriod/],
      ['money given as a number instead of a bigint', { monthlyBasic: 3_500_000 }, /monthlyBasic.*bigint/],
      ['a negative next period', { nextPeriod: -1 }, /nextPeriod/],
      ['an oversized next period', { nextPeriod: 2 ** 15 }, /nextPeriod/],
      ['a next period the covenant could never advance', { nextPeriod: 2 ** 15 - 1 }, /nextPeriod.*period \+ 1/],
      ['a fractional next period', { nextPeriod: 1.5 }, /nextPeriod.*whole number/],
      ['a next period that is not a number', { nextPeriod: '1' }, /nextPeriod/],
      ['a NaN next period', { nextPeriod: Number.NaN }, /nextPeriod/],
      ['an oversized end period', { endPeriod: 2 ** 15 }, /endPeriod/],
      ['an end period the covenant could never advance past', { endPeriod: 2 ** 15 - 1 }, /endPeriod.*period \+ 1/],
      ['a negative end period', { endPeriod: -1 }, /endPeriod/],
      ['a status of 2', { status: 2 }, /status/],
      ['a negative status', { status: -1 }, /status/],
      ['a boolean status', { status: true }, /status/],
      ['an oversized employee number', { employeeNo: 2 ** 23 }, /employeeNo/],
      ['a negative employee number', { employeeNo: -1 }, /employeeNo/],
      ['a fractional employee number', { employeeNo: 1001.5 }, /employeeNo/],
    ])('rejects %s', (_case, overrides, message) => {
      expect(attempt(overrides)).toThrow(InvariantViolationError);
      expect(attempt(overrides)).toThrow(message);
    });

    it('raises a domain error with the stable machine-readable code', () => {
      try {
        encodeCommitment({ ...validRecord(), monthlyBasic: -1n });
        expect.unreachable('encoding a negative salary should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(InvariantViolationError);
        expect((error as InvariantViolationError).code).toBe('DOMAIN.INVARIANT_VIOLATION');
        expect((error as InvariantViolationError).subject).toBe('EmploymentCommitment');
      }
    });
  });

  describe('decode rejects malformed commitments', () => {
    it.each([
      ['an empty buffer', 0],
      ['one byte short', COMMITMENT_BYTES - 1],
      ['one byte long', COMMITMENT_BYTES + 1],
      ['a 32-byte hash mistaken for a commitment', 32],
    ])('rejects %s', (_case, length) => {
      expect(() => decodeCommitment(new Uint8Array(length))).toThrow(InvariantViolationError);
      expect(() => decodeCommitment(new Uint8Array(length))).toThrow(/exactly 40 bytes/);
    });

    it('rejects something that is not a byte array at all', () => {
      expect(() => decodeCommitment('00'.repeat(40) as unknown as Uint8Array)).toThrow(InvariantViolationError);
    });

    it('returns an unknown status byte raw instead of throwing — one bad record must not crash a payroll walk', () => {
      const bytes = encodeCommitment(validRecord());
      bytes[COMMITMENT_LAYOUT.status.offset] = 0x02;

      expect(decodeCommitment(bytes).status).toBe(2);

      bytes[COMMITMENT_LAYOUT.status.offset] = 0xff;

      expect(decodeCommitment(bytes).status).toBe(255);
    });

    it('still refuses to ENCODE the unknown status a lenient decode hands back', () => {
      const bytes = encodeCommitment(validRecord());
      bytes[COMMITMENT_LAYOUT.status.offset] = 0x02;

      expect(() => encodeCommitment(decodeCommitment(bytes))).toThrow(/status/);
    });

    it('rejects a field whose sign bit is set — the VM would read it as negative', () => {
      const bytes = encodeCommitment(validRecord());
      bytes[COMMITMENT_LAYOUT.monthlyBasic.offset + 3] = 0x80;

      // 0x80000000 is not 2,147,483,648 to a Script number; it is negative zero.
      expect(() => decodeCommitment(bytes)).toThrow(/monthlyBasic/);
    });

    it('hands a well-formed record straight back to encode without complaint', () => {
      const bytes = encodeCommitment(validRecord());

      expect(() => encodeCommitment(decodeCommitment(bytes))).not.toThrow();
    });
  });

  describe('the golden vector — fixture A, byte for byte', () => {
    // If this literal ever changes, the covenant, the transaction builder and
    // every already-minted employment NFT change with it. That is the point of
    // pinning it here rather than recomputing it.
    const GOLDEN_ANALYST_HEX =
      '8e5e102cb0c472b15486dc977ce7706c3211cc2be0673500400d0300108f01000100180001e90300';

    it('encodes to the expected 80 hex characters', () => {
      expect(GOLDEN_ANALYST_HEX).toHaveLength(COMMITMENT_BYTES * 2);
      expect(commitmentToHex(encodeCommitment(ANALYST_COMMITMENT))).toBe(GOLDEN_ANALYST_HEX);
    });

    it('decodes back to Maria Santos on ₱35,000 + ₱2,000 with ₱1,021.60 withheld', () => {
      expect(decodeCommitment(commitmentFromHex(GOLDEN_ANALYST_HEX))).toEqual({
        payeePkh: ALICE_PKH,
        monthlyBasic: 3_500_000n,
        monthlyAllowance: 200_000n,
        taxPerPeriod: 102_160n,
        nextPeriod: 1,
        endPeriod: 24,
        status: EMPLOYMENT_STATUS_ACTIVE,
        employeeNo: 1001,
      });
    });

    it('reads as the documented slices', () => {
      expect(GOLDEN_ANALYST_HEX.slice(0, 40)).toBe('8e5e102cb0c472b15486dc977ce7706c3211cc2b'); // payeePkh
      expect(GOLDEN_ANALYST_HEX.slice(40, 48)).toBe('e0673500'); // ₱35,000.00 LE
      expect(GOLDEN_ANALYST_HEX.slice(48, 56)).toBe('400d0300'); // ₱2,000.00 LE
      expect(GOLDEN_ANALYST_HEX.slice(56, 64)).toBe('108f0100'); // ₱1,021.60 LE
      expect(GOLDEN_ANALYST_HEX.slice(64, 68)).toBe('0100'); // nextPeriod 1
      expect(GOLDEN_ANALYST_HEX.slice(68, 72)).toBe('1800'); // endPeriod 24
      expect(GOLDEN_ANALYST_HEX.slice(72, 74)).toBe('01'); // active
      expect(GOLDEN_ANALYST_HEX.slice(74, 80)).toBe('e90300'); // employee 1001
    });

    it('pins fixture B as well — the zero-tax, zero-allowance shape', () => {
      expect(commitmentToHex(encodeCommitment(ENTRY_LEVEL_COMMITMENT))).toBe(
        'fd8c18100707eebe8772863179065994115515a2006a1800000000000000000007000401' + '01' + 'ea0300',
      );
    });
  });

  describe('hex helpers', () => {
    it('round-trips bytes through lowercase hex', () => {
      const bytes = encodeCommitment(ANALYST_COMMITMENT);
      const hex = commitmentToHex(bytes);

      expect(hex).toBe(hex.toLowerCase());
      expect(commitmentFromHex(hex)).toEqual(bytes);
    });

    it('accepts uppercase input', () => {
      expect(commitmentFromHex('DEADBEEF')).toEqual(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it.each([
      ['an odd number of characters', 'abc'],
      ['non-hex characters', 'zz'],
      ['a 0x prefix', '0xdeadbeef'],
    ])('rejects %s', (_case, hex) => {
      expect(() => commitmentFromHex(hex)).toThrow(InvariantViolationError);
    });
  });

  describe('the status flag', () => {
    it.each([
      ['active', EMPLOYMENT_STATUS_ACTIVE],
      ['inactive', EMPLOYMENT_STATUS_INACTIVE],
    ])('round-trips %s', (_case, status) => {
      const record: EmploymentCommitment = { ...validRecord(), status: status as EmploymentStatusCode };

      expect(decodeCommitment(encodeCommitment(record)).status).toBe(status);
    });

    it('occupies a single byte, so a suspension flips exactly one byte in the record', () => {
      const active = encodeCommitment({ ...validRecord(), status: EMPLOYMENT_STATUS_ACTIVE });
      const suspended = encodeCommitment({ ...validRecord(), status: EMPLOYMENT_STATUS_INACTIVE });

      const differing = [...active].filter((byte, index) => byte !== suspended[index]);

      expect(differing).toHaveLength(1);
      expect(active[COMMITMENT_LAYOUT.status.offset]).toBe(1);
      expect(suspended[COMMITMENT_LAYOUT.status.offset]).toBe(0);
    });
  });
});
