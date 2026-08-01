import { describe, expect, it } from 'vitest';
import { BchNetwork, CashAddress, InvariantViolationError } from '../../src/domain/index.js';
import { ALICE_MAINNET, ALICE_TESTNET, INVALID_CHECKSUM_TESTNET } from '../support/addresses.js';

describe('CashAddress', () => {
  it('derives the network from the prefix', () => {
    expect(CashAddress.parse(ALICE_TESTNET).network).toBe(BchNetwork.Testnet);
    expect(CashAddress.parse(ALICE_MAINNET).network).toBe(BchNetwork.Mainnet);
  });

  it('normalises case and surrounding whitespace', () => {
    expect(CashAddress.parse(`  ${ALICE_TESTNET.toUpperCase()}  `).value).toBe(ALICE_TESTNET);
  });

  it.each([
    ['no prefix', 'qz89uypvkrz89v25smwfwl88wpkryywv9v93x698ty'],
    ['unknown prefix', 'dogecoin:qz89uypvkrz89v25smwfwl88wpkryywv9v93x698ty'],
    ['empty prefix', ':qz89uypvkrz89v25smwfwl88wpkryywv9v93x698ty'],
    ['characters outside the cashaddr alphabet', 'bchtest:qbio1uypvkrz89v25smwfwl88wpkryywv9v93x698t'],
    ['too short', 'bchtest:qz89uypv'],
  ])('rejects an address with %s', (_case, raw) => {
    expect(() => CashAddress.parse(raw)).toThrow(InvariantViolationError);
  });

  it('accepts a structurally valid address whose checksum is wrong', () => {
    // Documents the deliberate boundary: checksum verification needs crypto, so
    // it belongs to the AddressValidator port, not to the dependency-free domain.
    expect(() => CashAddress.parse(INVALID_CHECKSUM_TESTNET)).not.toThrow();
  });

  it('compares by value and reports its network', () => {
    const address = CashAddress.parse(ALICE_TESTNET);

    expect(address.equals(CashAddress.parse(ALICE_TESTNET))).toBe(true);
    expect(address.equals(CashAddress.parse(ALICE_MAINNET))).toBe(false);
    expect(address.belongsTo(BchNetwork.Testnet)).toBe(true);
    expect(address.belongsTo(BchNetwork.Mainnet)).toBe(false);
  });
});
