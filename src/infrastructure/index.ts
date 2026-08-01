/**
 * Public surface of the infrastructure layer.
 *
 * Only the composition root should import from here. A use case that reaches
 * for a concrete adapter has inverted the dependency rule, and the architecture
 * test in `tests/architecture` fails the build when that happens.
 */

export { ConfigurationError } from './config/configuration.error.js';
export {
  ChainMode,
  PersistenceMode,
  loadPayrollConfiguration,
  type PayrollConfiguration,
} from './config/payroll-configuration.js';

export { ConsoleLogger, type ConsoleLoggerOptions, type LogLevel } from './system/console-logger.js';
export { SystemClock } from './system/system-clock.js';
export { UuidIdGenerator } from './system/uuid-id-generator.js';

export { InMemoryEmployeeRepository } from './persistence/in-memory/in-memory-employee-repository.js';
export { InMemoryPayrollRunRepository } from './persistence/in-memory/in-memory-payroll-run-repository.js';
export { JsonFileEmployeeRepository } from './persistence/json-file/json-file-employee-repository.js';
export { JsonFilePayrollRunRepository } from './persistence/json-file/json-file-payroll-run-repository.js';
export { JsonFileStore } from './persistence/json-file/json-file-store.js';

export {
  CashScriptDisbursementGateway,
  type CashScriptDisbursementGatewayOptions,
} from './blockchain/cashscript-disbursement-gateway.js';
export { LibauthAddressValidator } from './blockchain/libauth-address-validator.js';
export { createNetworkProvider, toCashScriptNetwork } from './blockchain/network-provider.factory.js';
export {
  ContractArtifactMissingError,
  defaultArtifactDirectory,
  loadPayrollTreasuryArtifact,
  type PayrollTreasuryArtifact,
} from './blockchain/payroll-treasury-artifact.js';
export {
  createPayrollTreasuryContract,
  resolveTreasuryKeys,
  type PayrollTreasuryContract,
  type TreasuryKeys,
} from './blockchain/payroll-treasury.factory.js';
