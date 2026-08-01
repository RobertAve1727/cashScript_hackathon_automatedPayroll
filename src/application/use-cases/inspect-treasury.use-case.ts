import { toTreasuryDto, type TreasuryDto } from '../dto/treasury.dto.js';
import type { PayrollDisbursementGateway } from '../ports/payroll-disbursement-gateway.js';
import type { QueryUseCase } from './use-case.js';

/** Where the payroll money is and how much of it is left. */
export class InspectTreasuryUseCase implements QueryUseCase<TreasuryDto> {
  constructor(private readonly gateway: PayrollDisbursementGateway) {}

  async execute(): Promise<TreasuryDto> {
    return toTreasuryDto(await this.gateway.summarise());
  }
}
