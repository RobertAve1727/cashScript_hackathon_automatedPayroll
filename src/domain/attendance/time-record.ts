/**
 * The daily time record — the input a programmable payroll is missing.
 *
 * A payroll covenant can prove it paid the right person the right amount to
 * the right agencies. What it cannot know on its own is whether the day was
 * worked. That answer has to come from somewhere, and wherever it comes from
 * becomes the thing an employee has to trust. In an ordinary HRIS it is a row
 * in the employer's database, editable by whoever holds the admin password,
 * and "the system says you were absent" is the end of the conversation.
 *
 * So a time record here is a value object with a canonical byte encoding
 * (`encodeTimeRecord`), and that encoding is what gets anchored on chain the
 * moment the employee clocks in — see
 * `src/infrastructure/blockchain/esahod/attendance-anchor.ts`. The employer
 * can still dispute a day. What the employer cannot do is quietly change what
 * was recorded, because the original is in a block with a timestamp.
 *
 * All times are unix seconds. All durations are seconds. No floats.
 */

import { InvariantViolationError } from '../errors/invariant-violation.error.js';

/** A standard Philippine working day: 8 hours, exclusive of the meal break. */
export const STANDARD_WORKDAY_SECONDS = 8 * 60 * 60;

/** Basis points of a workday, so a fraction never becomes a float. */
export const WORKDAY_BASIS_POINTS = 10_000;

export type PunchKind = 'in' | 'out';

export const PUNCH_KIND_CODE: Readonly<Record<PunchKind, number>> = { in: 1, out: 2 };

export interface Punch {
  readonly employeeNo: number;
  readonly kind: PunchKind;
  /** Unix seconds at which the employee clocked. */
  readonly at: number;
}

export interface TimeRecord {
  readonly employeeNo: number;
  /** Calendar day the record belongs to, as `YYYY-MM-DD`. */
  readonly workDate: string;
  readonly timeIn: number;
  /** Absent while the employee is still clocked in. */
  readonly timeOut?: number;
}

/**
 * Seconds actually on the clock. An open record — clocked in, not yet out —
 * has worked nothing *yet*, which is different from having been absent.
 */
export function workedSeconds(record: TimeRecord): number {
  if (record.timeOut === undefined) return 0;

  const elapsed = record.timeOut - record.timeIn;
  if (elapsed < 0) {
    throw new InvariantViolationError('workedSeconds', `employee #${record.employeeNo} clocked out (${record.timeOut}) before clocking in (${record.timeIn}) on ${record.workDate}`,
    );
  }

  return elapsed;
}

/**
 * The fraction of a standard workday worked, in basis points of a day, capped
 * at one full day.
 *
 * Capping matters: overtime is a premium computed under its own rules (Art.
 * 87, at least 25% above the hourly rate), not simply more basic pay, and
 * silently paying it as straight time is a wage violation in the generous
 * direction that still misstates the payslip. Overtime is out of scope here
 * and the cap is what keeps it out rather than half-implementing it.
 */
export function workedBasisPoints(record: TimeRecord): number {
  const seconds = workedSeconds(record);
  const bp = Math.floor((seconds * WORKDAY_BASIS_POINTS) / STANDARD_WORKDAY_SECONDS);

  return Math.min(bp, WORKDAY_BASIS_POINTS);
}

/** The 0..1 fraction `computeScheduledDeductions` takes as `periodsWorked`. */
export function workedFraction(record: TimeRecord): number {
  return workedBasisPoints(record) / WORKDAY_BASIS_POINTS;
}

/** True once the employee has clocked out and the day can be paid. */
export function isSettled(record: TimeRecord): boolean {
  return record.timeOut !== undefined;
}

/**
 * Days worked across a period, in basis points — what a semi-monthly or weekly
 * run needs, where pay follows attendance across many days at once.
 */
export function totalBasisPoints(records: readonly TimeRecord[]): number {
  return records.reduce((total, record) => total + workedBasisPoints(record), 0);
}

/**
 * The canonical 13-byte anchor payload for one punch.
 *
 *   [0:4]   magic 'eSHD'      — identifies the protocol in a block explorer
 *   [4]     version           — 1
 *   [5]     kind              — 1 clock-in, 2 clock-out
 *   [6:9]   employeeNo        — 3 bytes, little-endian, same width the
 *                               employment commitment uses for the same field
 *   [9:13]  unix seconds      — 4 bytes, little-endian
 *
 * Little-endian throughout, matching the commitment codec, so the two are read
 * the same way. 13 bytes sits far below the 220-byte relay limit for
 * OP_RETURN, leaving room for the payload to grow without becoming
 * non-standard.
 */
export const ANCHOR_MAGIC = 'eSHD';
export const ANCHOR_VERSION = 1;
export const ANCHOR_BYTES = 13;

export function encodePunch(punch: Punch): Uint8Array {
  const { employeeNo, kind, at } = punch;

  if (!Number.isInteger(employeeNo) || employeeNo < 0 || employeeNo > 0xff_ff_ff) {
    throw new InvariantViolationError('encodePunch', `employeeNo must fit 3 bytes, got ${employeeNo}`);
  }
  if (!Number.isInteger(at) || at < 0 || at > 0xff_ff_ff_ff) {
    throw new InvariantViolationError('encodePunch', `timestamp must fit 4 unsigned bytes, got ${at}`);
  }

  const bytes = new Uint8Array(ANCHOR_BYTES);
  for (let index = 0; index < 4; index += 1) bytes[index] = ANCHOR_MAGIC.charCodeAt(index);
  bytes[4] = ANCHOR_VERSION;
  bytes[5] = PUNCH_KIND_CODE[kind];
  bytes[6] = employeeNo & 0xff;
  bytes[7] = (employeeNo >>> 8) & 0xff;
  bytes[8] = (employeeNo >>> 16) & 0xff;
  bytes[9] = at & 0xff;
  bytes[10] = (at >>> 8) & 0xff;
  bytes[11] = (at >>> 16) & 0xff;
  bytes[12] = (at >>> 24) & 0xff;

  return bytes;
}

/** Read a punch back out of an anchor payload. Returns null if it is not one. */
export function decodePunch(bytes: Uint8Array): Punch | null {
  if (bytes.length !== ANCHOR_BYTES) return null;
  for (let index = 0; index < 4; index += 1) {
    if (bytes[index] !== ANCHOR_MAGIC.charCodeAt(index)) return null;
  }
  if (bytes[4] !== ANCHOR_VERSION) return null;

  const kind = bytes[5] === PUNCH_KIND_CODE.in ? 'in' : bytes[5] === PUNCH_KIND_CODE.out ? 'out' : null;
  if (kind === null) return null;

  const employeeNo = bytes[6]! | (bytes[7]! << 8) | (bytes[8]! << 16);
  // `>>> 0` keeps the 4-byte timestamp unsigned; a plain `<< 24` would go
  // negative for any date after 2038-01-19, which is inside the working life
  // of a payroll system.
  const at = ((bytes[9]! | (bytes[10]! << 8) | (bytes[11]! << 16) | (bytes[12]! << 24)) >>> 0);

  return { employeeNo, kind, at };
}
