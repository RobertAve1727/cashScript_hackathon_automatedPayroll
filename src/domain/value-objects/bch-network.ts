/**
 * The Bitcoin Cash network an address or treasury belongs to.
 *
 * Deliberately coarser than the set of networks the CashScript provider knows
 * about (`testnet3`, `testnet4`, `chipnet`, …): the business rule the domain
 * enforces is "you cannot pay a testnet address from a mainnet treasury", and
 * that only needs these three. Mapping to a concrete network is infrastructure.
 */
export const BchNetwork = {
  Mainnet: 'mainnet',
  Testnet: 'testnet',
  Regtest: 'regtest',
} as const;

export type BchNetwork = (typeof BchNetwork)[keyof typeof BchNetwork];
