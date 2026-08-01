import {
  ApprovePayrollRunUseCase,
  ChangeEmploymentStatusUseCase,
  EnrolEmployeeUseCase,
  GetPayrollRunUseCase,
  InspectTreasuryUseCase,
  ListEmployeesUseCase,
  ListPayrollRunsUseCase,
  OpenPayrollRunUseCase,
  SettlePayrollRunUseCase,
  UpdateEmployeePayUseCase,
  type AddressValidator,
  type Clock,
  type IdGenerator,
  type Logger,
  type PayrollDisbursementGateway,
} from '../application/index.js';
import { PayrollCalculator, type EmployeeRepository, type PayrollRunRepository } from '../domain/index.js';
import {
  CashScriptDisbursementGateway,
  ConsoleLogger,
  InMemoryEmployeeRepository,
  InMemoryPayrollRunRepository,
  JsonFileEmployeeRepository,
  JsonFilePayrollRunRepository,
  LibauthAddressValidator,
  PersistenceMode,
  SystemClock,
  UuidIdGenerator,
  createNetworkProvider,
  createPayrollTreasuryContract,
  resolveTreasuryKeys,
  type PayrollConfiguration,
} from '../infrastructure/index.js';
import {
  ApprovePayrollRunCommand,
  ChangeEmploymentStatusCommand,
  CliApplication,
  EnrolEmployeeCommand,
  InspectTreasuryCommand,
  ListEmployeesCommand,
  ListPayrollRunsCommand,
  OpenPayrollRunCommand,
  SettlePayrollRunCommand,
  ShowPayrollRunCommand,
  StdoutOutput,
  UpdateEmployeePayCommand,
  type Command,
  type Output,
} from '../presentation/index.js';
import { LazyDisbursementGateway } from './lazy-disbursement-gateway.js';

/**
 * Anything a test may want to replace with a double.
 *
 * The production path uses none of these; they exist so a test can drive the
 * real CLI end to end against fake storage and a fake chain.
 */
export interface CompositionOverrides {
  readonly output?: Output;
  readonly errorOutput?: Output;
  readonly logger?: Logger;
  readonly clock?: Clock;
  readonly idGenerator?: IdGenerator;
  readonly addressValidator?: AddressValidator;
  readonly employees?: EmployeeRepository;
  readonly payrollRuns?: PayrollRunRepository;
  readonly disbursementGateway?: PayrollDisbursementGateway;
}

/**
 * The composition root — the one place allowed to know every layer at once.
 *
 * Every dependency is constructed here and passed inwards through constructors.
 * Nothing else in the codebase calls `new` on an adapter, and no class ever
 * reaches out to a container to fetch a collaborator, so the dependency graph
 * is a value you can read top to bottom in this function.
 */
export function composePayrollCli(
  config: PayrollConfiguration,
  overrides: CompositionOverrides = {},
): CliApplication {
  const output = overrides.output ?? new StdoutOutput();
  const errorOutput = overrides.errorOutput ?? output;

  const logger = overrides.logger ?? new ConsoleLogger();
  const clock = overrides.clock ?? new SystemClock();
  const idGenerator = overrides.idGenerator ?? new UuidIdGenerator();
  const addressValidator = overrides.addressValidator ?? new LibauthAddressValidator();

  const employees = overrides.employees ?? createEmployeeRepository(config);
  const payrollRuns = overrides.payrollRuns ?? createPayrollRunRepository(config);
  const gateway = overrides.disbursementGateway ?? new LazyDisbursementGateway(() => createDisbursementGateway(config));

  const calculator = new PayrollCalculator();

  const commands: Command[] = [
    new EnrolEmployeeCommand(
      new EnrolEmployeeUseCase(employees, addressValidator, idGenerator, clock, logger, config.network),
    ),
    new ListEmployeesCommand(new ListEmployeesUseCase(employees)),
    new UpdateEmployeePayCommand(new UpdateEmployeePayUseCase(employees, logger)),
    new ChangeEmploymentStatusCommand(new ChangeEmploymentStatusUseCase(employees, logger)),
    new OpenPayrollRunCommand(
      new OpenPayrollRunUseCase(payrollRuns, employees, calculator, idGenerator, clock, logger),
    ),
    new ApprovePayrollRunCommand(new ApprovePayrollRunUseCase(payrollRuns, clock, logger)),
    new SettlePayrollRunCommand(new SettlePayrollRunUseCase(payrollRuns, gateway, clock, logger)),
    new ShowPayrollRunCommand(new GetPayrollRunUseCase(payrollRuns)),
    new ListPayrollRunsCommand(new ListPayrollRunsUseCase(payrollRuns)),
    new InspectTreasuryCommand(new InspectTreasuryUseCase(gateway)),
  ];

  return new CliApplication(commands, output, errorOutput);
}

function createEmployeeRepository(config: PayrollConfiguration): EmployeeRepository {
  return config.persistence === PersistenceMode.Memory
    ? new InMemoryEmployeeRepository()
    : new JsonFileEmployeeRepository(config.dataDirectory);
}

function createPayrollRunRepository(config: PayrollConfiguration): PayrollRunRepository {
  return config.persistence === PersistenceMode.Memory
    ? new InMemoryPayrollRunRepository()
    : new JsonFilePayrollRunRepository(config.dataDirectory);
}

function createDisbursementGateway(config: PayrollConfiguration): PayrollDisbursementGateway {
  const provider = createNetworkProvider(config);
  const keys = resolveTreasuryKeys(config);

  return new CashScriptDisbursementGateway({
    contract: createPayrollTreasuryContract(config, provider, keys),
    operator: keys.operator,
    network: config.network,
    payoutIntervalBlocks: config.payoutIntervalBlocks,
    feeRateSatsPerByte: config.feeRateSatsPerByte,
  });
}
