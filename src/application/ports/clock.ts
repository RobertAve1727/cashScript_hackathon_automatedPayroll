/**
 * Source of the current time.
 *
 * Use cases never call `new Date()` directly. Time is an input like any other,
 * so tests can settle a payroll run at a fixed instant and assert on it.
 */
export interface Clock {
  now(): Date;
}
