import { binToHex, hexToBin } from '@bitauth/libauth';
import { MockNetworkProvider, SignatureTemplate, randomUtxo } from 'cashscript';
import { describe, expect, it } from 'vitest';
import {
  ANCHOR_BYTES,
  STANDARD_WORKDAY_SECONDS,
  decodePunch,
  encodePunch,
  isSettled,
  totalBasisPoints,
  workedBasisPoints,
  workedFraction,
  workedSeconds,
  type Punch,
  type TimeRecord,
} from '../../../src/domain/attendance/time-record.js';
import { buildAttendanceAnchorTransaction } from '../../../src/infrastructure/blockchain/esahod/attendance-anchor.js';

/**
 * Two things are proven here. First, that a punch survives a round trip
 * through its byte encoding — the encoding is the record, so a codec bug is a
 * payroll bug. Second, that the anchoring transaction is accepted by the BCH
 * VM and that the punch can be read back out of the broadcast bytes, which is
 * what "on chain from the moment of time-in" has to mean to be worth claiming.
 */

const employee = new SignatureTemplate(hexToBin('a1'.repeat(32)));
const employeeLock = employee.unlockP2PKH().generateLockingBytecode();

const CLOCK_IN: Punch = { employeeNo: 1001, kind: 'in', at: 1_785_555_600 };

function fundedProvider(satoshis = 20_000n) {
  const provider = new MockNetworkProvider();
  const utxo = randomUtxo({ satoshis });
  provider.addUtxo(binToHex(employeeLock), utxo);
  return { provider, utxo };
}

describe('the punch codec', () => {
  it('round-trips every field', () => {
    for (const punch of [
      CLOCK_IN,
      { employeeNo: 1001, kind: 'out', at: 1_785_588_000 } as const,
      { employeeNo: 0, kind: 'in', at: 0 } as const,
      { employeeNo: 0xff_ff_ff, kind: 'out', at: 0xff_ff_ff_ff } as const,
    ]) {
      const bytes = encodePunch(punch);

      expect(bytes).toHaveLength(ANCHOR_BYTES);
      expect(decodePunch(bytes)).toEqual(punch);
    }
  });

  it('survives 2038 — the 4-byte timestamp is unsigned', () => {
    // A signed read would go negative here and silently misdate every record
    // for the rest of the system's life.
    const punch: Punch = { employeeNo: 1001, kind: 'in', at: 2_500_000_000 };

    expect(decodePunch(encodePunch(punch))?.at).toBe(2_500_000_000);
  });

  it('carries the magic so unrelated OP_RETURNs are not mistaken for punches', () => {
    const foreign = encodePunch(CLOCK_IN);
    foreign[0] = 'X'.charCodeAt(0);

    expect(decodePunch(foreign)).toBeNull();
    expect(decodePunch(new Uint8Array(ANCHOR_BYTES))).toBeNull();
    expect(decodePunch(encodePunch(CLOCK_IN).slice(0, 12))).toBeNull();
  });

  it('refuses a field that would not fit its width', () => {
    expect(() => encodePunch({ ...CLOCK_IN, employeeNo: 0x1_00_00_00 })).toThrow(/3 bytes/);
    expect(() => encodePunch({ ...CLOCK_IN, at: 0x1_00_00_00_00 })).toThrow(/4 unsigned bytes/);
  });
});

describe('worked time', () => {
  const workDate = '2026-08-03';

  it('an open record has worked nothing yet, which is not absence', () => {
    const open: TimeRecord = { employeeNo: 1001, workDate, timeIn: CLOCK_IN.at };

    expect(isSettled(open)).toBe(false);
    expect(workedSeconds(open)).toBe(0);
  });

  it('a full day is a full day', () => {
    const record: TimeRecord = {
      employeeNo: 1001,
      workDate,
      timeIn: CLOCK_IN.at,
      timeOut: CLOCK_IN.at + STANDARD_WORKDAY_SECONDS,
    };

    expect(workedBasisPoints(record)).toBe(10_000);
    expect(workedFraction(record)).toBe(1);
  });

  it('a half day is half, to the basis point', () => {
    const record: TimeRecord = {
      employeeNo: 1001,
      workDate,
      timeIn: CLOCK_IN.at,
      timeOut: CLOCK_IN.at + STANDARD_WORKDAY_SECONDS / 2,
    };

    expect(workedBasisPoints(record)).toBe(5_000);
    expect(workedFraction(record)).toBe(0.5);
  });

  it('caps at one day — overtime is a premium, not extra straight time', () => {
    // Art. 87 puts overtime at least 25% above the hourly rate. Paying it as
    // straight time would be wrong in the generous direction and still
    // misstate the payslip, so the cap keeps it out rather than half-doing it.
    const record: TimeRecord = {
      employeeNo: 1001,
      workDate,
      timeIn: CLOCK_IN.at,
      timeOut: CLOCK_IN.at + STANDARD_WORKDAY_SECONDS * 2,
    };

    expect(workedBasisPoints(record)).toBe(10_000);
  });

  it('refuses a clock-out that precedes its clock-in', () => {
    const impossible: TimeRecord = {
      employeeNo: 1001,
      workDate,
      timeIn: CLOCK_IN.at,
      timeOut: CLOCK_IN.at - 60,
    };

    expect(() => workedSeconds(impossible)).toThrow(/clocked out .* before clocking in/);
  });

  it('totals a period', () => {
    const day = (offset: number, seconds: number): TimeRecord => ({
      employeeNo: 1001,
      workDate,
      timeIn: CLOCK_IN.at + offset,
      timeOut: CLOCK_IN.at + offset + seconds,
    });

    expect(
      totalBasisPoints([
        day(0, STANDARD_WORKDAY_SECONDS),
        day(86_400, STANDARD_WORKDAY_SECONDS / 2),
        day(172_800, STANDARD_WORKDAY_SECONDS),
      ]),
    ).toBe(25_000); // two and a half days
  });
});

describe('anchoring a punch on chain', () => {
  it('is accepted by the BCH VM', async () => {
    const { provider, utxo } = fundedProvider();

    const tx = buildAttendanceAnchorTransaction({
      provider,
      punch: CLOCK_IN,
      fundingUtxos: [utxo],
      signer: employee,
      changeLockingBytecode: employeeLock,
    });

    await expect(tx.send()).resolves.toBeDefined();
  });

  it('writes the punch where a block explorer will show it, and it decodes back', async () => {
    const { provider, utxo } = fundedProvider();

    const tx = buildAttendanceAnchorTransaction({
      provider,
      punch: CLOCK_IN,
      fundingUtxos: [utxo],
      signer: employee,
      changeLockingBytecode: employeeLock,
    });

    const opReturn = tx.outputs[0]!;
    expect(opReturn.amount).toBe(0n); // provably unspendable, adds nothing to the UTXO set

    // The locking bytecode is OP_RETURN (0x6a), a 13-byte push (0x0d), then
    // the payload. Reading it back the way an indexer would is the point.
    const script = opReturn.to as Uint8Array;
    expect(script[0]).toBe(0x6a);
    expect(script[1]).toBe(ANCHOR_BYTES);

    expect(decodePunch(script.slice(2))).toEqual(CLOCK_IN);
  });

  it('leaves the employee their change — anchoring costs a fee, not a wallet', async () => {
    const { provider, utxo } = fundedProvider(20_000n);

    await buildAttendanceAnchorTransaction({
      provider,
      punch: CLOCK_IN,
      fundingUtxos: [utxo],
      signer: employee,
      changeLockingBytecode: employeeLock,
    }).send();

    const [change] = await provider.getUtxosForLockingBytecode(binToHex(employeeLock));
    expect(change?.satoshis).toBeGreaterThan(19_000n);
  });

  it('refuses to build with nothing to pay the fee', () => {
    const { provider } = fundedProvider();

    expect(() =>
      buildAttendanceAnchorTransaction({
        provider,
        punch: CLOCK_IN,
        fundingUtxos: [],
        signer: employee,
        changeLockingBytecode: employeeLock,
      }),
    ).toThrow(/no funding UTXO/);
  });
});
