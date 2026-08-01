import type { BchNetwork } from '../../domain/index.js';
import type { TreasurySummary } from '../ports/payroll-disbursement-gateway.js';

export interface TreasuryDto {
  readonly address: string;
  readonly network: BchNetwork;
  readonly availableFundsSats: string;
  readonly availableFundsBch: string;
}

export function toTreasuryDto(summary: TreasurySummary): TreasuryDto {
  return {
    address: summary.address.value,
    network: summary.network,
    availableFundsSats: summary.availableFunds.toString(),
    availableFundsBch: summary.availableFunds.toBchString(),
  };
}
