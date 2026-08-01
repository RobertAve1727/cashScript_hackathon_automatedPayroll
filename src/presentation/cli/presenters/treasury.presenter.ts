import type { TreasuryDto } from '../../../application/index.js';

export function presentTreasury(treasury: TreasuryDto, asJson: boolean): string {
  if (asJson) return JSON.stringify(treasury, null, 2);

  return [
    `network    ${treasury.network}`,
    `address    ${treasury.address}`,
    `available  ${treasury.availableFundsBch} BCH (${treasury.availableFundsSats} sats)`,
  ].join('\n');
}
