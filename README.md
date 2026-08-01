# Automated Payroll on Bitcoin Cash

A payroll system that pays employees from an on-chain treasury, built as a **clean architecture** reference you can start a real project from.

The point of the layout below is that the interesting part — who gets paid, how much, when, and what happens when a payment fails — is written in plain TypeScript with **zero dependencies**, and Bitcoin Cash is a detail plugged in at the edge.

```
                     ┌──────────────────────────────────────────┐
                     │  main/         composition root          │  wires everything
                     ├──────────────────────────────────────────┤
                     │  presentation/  CLI, presenters          │  delivery
                     │  infrastructure/ CashScript, files, sys  │  adapters
                     ├──────────────────────────────────────────┤
                     │  application/   use cases, ports, DTOs   │  orchestration
                     ├──────────────────────────────────────────┤
                     │  domain/        entities, value objects  │  rules
                     └──────────────────────────────────────────┘
                           dependencies point only inwards ▲
```

## Quick start

```bash
npm install
npm run contracts:compile     # .cash → artifacts/*.json
npm run verify                # typecheck + 169 tests
```

Then drive it. The defaults use an in-process mock chain, so nothing below touches a network or real money:

```bash
alias payroll='npm run --silent payroll --'

payroll employee:add --name "Alice Rivera" \
  --address bchtest:qz89uypvkrz89v25smwfwl88wpkryywv9v93x698ty \
  --salary 0.5 --withholding-bps 750

payroll employee:add --name "Bob Chen" \
  --address bchtest:qr7ccxqsqur7a058w2rrz7gxtx2pz4g45gsxh8wz2k \
  --salary 0.25

payroll employee:list
payroll payroll:open --from 2026-08-01 --to 2026-08-16   # calculates; moves no money
payroll payroll:approve --id <run-id>                    # sign-off
payroll payroll:settle  --id <run-id>                    # pays, one transaction
payroll treasury:show
```

Every command takes `--json` for scripting. Results go to stdout, logs to stderr, so `payroll employee:list --json | jq` stays clean.

## The dependency rule, enforced

The arrows in that diagram are checked by [tests/architecture/dependency-rule.test.ts](tests/architecture/dependency-rule.test.ts), which parses every import in `src/` and fails the build on a violation:

| Layer | May import | Third-party | Node built-ins |
|---|---|---|---|
| `domain` | `domain` | ✗ | ✗ |
| `application` | `domain` | ✗ | ✗ |
| `infrastructure` | `domain`, `application` | ✓ | ✓ |
| `presentation` | `domain`, `application` | ✓ | ✓ |
| `main` | anything | ✓ | ✓ |

Plus two specific rules: **CashScript and libauth may only be imported by `infrastructure`**, and **only `main` may import `infrastructure`**. An architecture that is only described in a README stops being true the first time someone adds a convenient import; this one fails CI instead.

## What lives where

```
contracts/payroll_treasury.cash      the on-chain treasury
artifacts/                           compiled output, committed (see below)

src/domain/                          no dependencies at all
  value-objects/  Satoshis, CashAddress, PayrollPeriod, Payslip, Settlement, BasisPoints
  entities/       Employee, PayrollRun          ← lifecycles and invariants
  services/       PayrollCalculator             ← pure payroll maths
  repositories/   EmployeeRepository, PayrollRunRepository   (ports, implemented outside)

src/application/                     depends only on domain
  ports/          Clock, IdGenerator, Logger, AddressValidator,
                  PayrollDisbursementGateway    ← the seam money leaves through
  use-cases/      EnrolEmployee, OpenPayrollRun, ApprovePayrollRun, SettlePayrollRun, …
  dto/            flat, JSON-safe output types

src/infrastructure/                  implements the ports
  blockchain/     CashScriptDisbursementGateway, LibauthAddressValidator, contract factory
  persistence/    in-memory and JSON-file repositories
  system/         SystemClock, UuidIdGenerator, ConsoleLogger
  config/         environment parsing and validation

src/presentation/cli/                commands, argument parsing, presenters
src/main/                            composition root + entry point
```

## Design decisions worth knowing

**Money is `bigint`, always.** [`Satoshis`](src/domain/value-objects/satoshis.ts) refuses `number` input for BCH amounts and parses decimal strings itself, so `0.1 + 0.2` is exactly `0.3` and a satoshi cannot be lost to floating point between calculation and transaction output.

**Address validation is split deliberately.** [`CashAddress`](src/domain/value-objects/cash-address.ts) validates prefix, alphabet and length with no dependencies. Checksum verification needs crypto, so it is the [`AddressValidator`](src/application/ports/address-validator.ts) port, implemented with libauth. A transposed character passes the first and fails the second — which matters, because a BCH payment to a wrong-but-valid address is final.

**A payroll run is a state machine.** `draft → approved → settled`, with `failed` as a retryable branch. Money moves only for an `approved` run, `settled` is terminal, and a rejected broadcast records its reason and stays retryable via `payroll:approve`. See [`PayrollRun`](src/domain/entities/payroll-run.ts) and [`SettlePayrollRunUseCase`](src/application/use-cases/settle-payroll-run.use-case.ts).

**One transaction per run.** Either everyone is paid or nobody is; a half-settled payroll has no valid representation in the model.

**Dust is a domain rule.** A payslip whose net pay falls below 546 sats is rejected when the run is calculated, not when the network refuses to relay it.

**Repositories store snapshots.** Even the in-memory adapter rehydrates aggregates on read, so an unsaved mutation can never leak between use cases — a bug that would appear only after swapping in a real database.

## The contract

[`contracts/payroll_treasury.cash`](contracts/payroll_treasury.cash) has two spending paths:

- **`disburse(operatorSig)`** — the operator signs a run, but `this.age >= payoutInterval` requires the coin being spent to be at least N blocks old (`OP_CHECKSEQUENCEVERIFY`). Because each run pays its change back into the treasury, consecutive runs chain through that change output and are rate limited by consensus. A leaked operator key cannot drain the treasury by replaying runs.
- **`reclaim(treasurerPk, treasurerSig)`** — a separate, colder key can always sweep the treasury. The escape hatch.

**Read this before deploying with real money.** `this.age` is a *relative* timelock and applies **per UTXO, not per address**. Fund the treasury with five coins and five disbursements can happen in one block. Fund it as a single coin and let change carry the balance forward, and the limit holds. Enforcing one run per period for the *address* needs a covenant — introspecting `tx.outputs[n].lockingBytecode` to require change returns to the same contract — which is the natural next extension.

The contract address is derived from its constructor arguments, so changing either key or the payout interval yields a **different address**. Sweep with `reclaim` before rotating.

### Why artifacts are in git

`artifacts/*.json` is committed build output. It means deployments never need the compiler, and the exact bytecode that controls the treasury is reviewable in a diff. Recompile with `npm run contracts:compile` after editing the `.cash` source.

## Testing

169 tests, no mocking framework — the [fakes](tests/support/fakes.ts) are hand-written implementations of the ports, which doubles as evidence that the ports are small enough to be worth having.

| Suite | What it proves |
|---|---|
| `tests/domain` | Payroll rules, in isolation, with no test doubles at all |
| `tests/application` | Orchestration: funding checks, failure recording, retry |
| `tests/infrastructure` | One shared contract suite run against **both** repository adapters; the CashScript gateway builds, signs and VM-evaluates a real transaction against `MockNetworkProvider` |
| `tests/presentation` | The real composition root end to end, with only storage and the chain faked |
| `tests/architecture` | The dependency rule above |

```bash
npm test              # once
npm run test:watch    # watch
npm run typecheck     # tsc, strict + noUncheckedIndexedAccess + exactOptionalPropertyTypes
```

## Configuration

All optional; defaults run the offline demo. See [.env.example](.env.example).

| Variable | Default | Notes |
|---|---|---|
| `PAYROLL_NETWORK` | `testnet` | `mainnet` \| `testnet` \| `regtest` |
| `PAYROLL_CHAIN` | `mock` | `mock` (in-process) \| `electrum` (real server) |
| `PAYROLL_PERSISTENCE` | `file` | `file` \| `memory` |
| `PAYROLL_DATA_DIR` | `.payroll-data` | JSON storage location |
| `PAYROLL_OPERATOR_WIF` | — | **Required** when `PAYROLL_CHAIN=electrum` |
| `PAYROLL_TREASURER_PKH` | — | **Required** when `PAYROLL_CHAIN=electrum`; hash160 hex |
| `PAYROLL_PAYOUT_INTERVAL_BLOCKS` | `1` | On-chain rate limit; ~4032 ≈ a fortnight |
| `PAYROLL_FEE_RATE` | `1` | Satoshis per byte |

Configuration is parsed and validated in [one file](src/infrastructure/config/payroll-configuration.ts) and fails at start-up with the variable name attached. Nothing else in the codebase reads `process.env`. Hardcoded development keys are refused outright when `PAYROLL_CHAIN=electrum`.

## Extending it

**A new business operation** → a use case class in `src/application/use-cases/`, plus a command in `src/presentation/cli/commands/`, wired in [`container.ts`](src/main/container.ts). If it needs a new rule, the rule goes in the entity.

**A database instead of JSON files** → implement `EmployeeRepository` and `PayrollRunRepository` in `src/infrastructure/persistence/`, add them to the shared contract test, change two lines in the container. No use case is touched.

**An HTTP API instead of a CLI** → a new folder beside `presentation/cli/` calling the same use cases. The business logic is already delivery-agnostic; that is what the CLI being this thin demonstrates.

**Pay in something other than BCH** → implement `PayrollDisbursementGateway`. It is two methods, and it is the only thing standing between the payroll rules and a blockchain.
