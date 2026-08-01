/**
 * Consensus and business constants that the domain is allowed to know about.
 *
 * The dust limit is a Bitcoin Cash network rule rather than a company policy,
 * but the domain still owns it: a payslip whose net pay cannot be represented
 * as a spendable output is not a valid payslip, whatever the infrastructure is.
 */

/** Outputs below this value are rejected by the network as dust. */
export const DUST_LIMIT_SATOSHIS = 546n;

/** Basis points that make up 100%. */
export const BASIS_POINTS_SCALE = 10_000;

/** Satoshis in one BCH. */
export const SATOSHIS_PER_BCH = 100_000_000n;

/** Total BCH supply, in satoshis — the ceiling for any amount. */
export const MAX_SUPPLY_SATOSHIS = 2_100_000_000_000_000n;
