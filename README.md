# eSahod

**Automated Philippine private-sector payroll on Bitcoin Cash, built on CashTokens.**

A company funds one on-chain treasury with ePHP — a fungible CashToken where 1 unit is 1
centavo. Every employee is a mutable CashToken NFT ("the employment record") carrying their
wallet, their salary, their withholding tax and a monotonic pay-period counter in a 40-byte
commitment. Paying that employee is a single, permissionless, atomic Bitcoin Cash transaction
that sends net pay to the employee and the SSS, PhilHealth and Pag-IBIG contributions to those
agencies **in the same transaction** — the deduction and the remittance are literally the same
event. In a normal payroll they are two events months apart, and non-remittance of money
already withheld from a worker's payslip is the single most common wage complaint in the
Philippines. eSahod does not make that complaint illegal; it makes it geometrically impossible,
because there is no state in which the deduction happened and the remittance did not.

This README documents exactly what is in this repository today. Where something is a roadmap
item rather than a shipped feature, it is labelled as one.

## Contents

- [Architecture](#architecture)
  - [The two covenants](#the-two-covenants)
  - [The 40-byte employment commitment](#the-40-byte-employment-commitment)
  - [The payroll transaction](#the-payroll-transaction)
  - [The trust model, stated honestly](#the-trust-model-stated-honestly)
- [Quick start — the mock demo](#quick-start--the-mock-demo)
- [The chipnet path](#the-chipnet-path)
- [Reconciliation, to the centavo](#reconciliation-to-the-centavo)
- [Frontend](#frontend)
- [Legacy scaffold](#legacy-scaffold)
- [Repository layout](#repository-layout)
- [Testing](#testing)

## Architecture

### The two covenants

| Contract | File | Compiled | Job |
|---|---|---|---|
| `PayrollTreasury` | [`contracts/payroll_treasury.cash`](contracts/payroll_treasury.cash) | 533 bytes, 284 opcodes | Holds one company's ePHP funding for one payroll cycle. Its only spending path that moves money, `paySalary`, releases funds in exactly one shape: a lawful semi-monthly disbursement to one employee plus every statutory remittance, computed from that employee's own record. No signature required. |
| `EmploymentVault` | [`contracts/employment_vault.cash`](contracts/employment_vault.cash) | 55 bytes, 41 opcodes | Where an employment record NFT sits between paydays. `payroll()` (anyone) lets the treasury spend the record only if it is genuinely input 0 of the same transaction. `amend()` (HR-signed) is the only way to edit a record, and it refuses to let the period counter move backwards. |

They complete each other. `PayrollTreasury.paySalary` refuses to run unless input 1 is an NFT of
the company's trusted `employmentCategory` — that's what stops a forged record from being paid.
`EmploymentVault.payroll` refuses to let the record be spent at all unless input 0 is *this
specific, deployed* treasury (`treasuryLock`, the treasury's 35-byte P2SH32 locking bytecode) —
that's what stops the record from being paired with a look-alike contract that advances the
period counter without paying anyone. Neither guarantee exists without the other.

`PayrollTreasury` is deployed fresh per funding cycle; `EmploymentVault` is parameterised by
`treasuryLock`, so a new cycle means a new vault too. Employment records migrate between vaults
through an HR-signed `amend()` — the only power that transaction has is to relocate the record
and edit its fields; it cannot rewind the period counter (see the trust model below).

### The 40-byte employment commitment

CashTokens caps an NFT commitment at 40 bytes. The layout uses all of them
([`src/domain/payroll/types.ts`](src/domain/payroll/types.ts)):

| Field | Offset | Bytes | Meaning |
|---|---:|---:|---|
| `payeePkh` | 0 | 20 | The employee's P2PKH hash. Living *inside* the commitment, not in a contract parameter, is what makes triggering payroll safe to hand to anyone. |
| `monthlyBasic` | 20 | 4 | Monthly basic salary, centavos. Base for PhilHealth. |
| `monthlyAllowance` | 24 | 4 | Monthly allowances forming part of compensation, centavos. Added to basic for SSS/Pag-IBIG. |
| `taxPerPeriod` | 28 | 4 | Withholding tax for this period. HR computes it off chain; the chain enforces the exact number to the exact BIR address. |
| `nextPeriod` | 32 | 2 | Monotonic counter. **The anti-double-payment mechanism** — see below. |
| `endPeriod` | 34 | 2 | Last payable period. Fixed-term and project-based contracts expire on their own. |
| `status` | 36 | 1 | `1` active, `0` suspended/separated. The covenant refuses to pay anything else. |
| `employeeNo` | 37 | 3 | Company employee number, for the audit trail. |

Values are read on chain with CashScript's `int()` cast — little-endian, with the top bit of the
last byte as a sign flag — so the codec at
[`src/domain/payroll/commitment.ts`](src/domain/payroll/commitment.ts) refuses to encode any
field that would flip that bit. It also caps `nextPeriod`/`endPeriod` one below their 2-byte
sign-bit limit (32766, not 32767) so the covenant can always write `period + 1` back into the
same two bytes — see `MAX_ENCODABLE_PERIOD` in that file.

### The payroll transaction

`paySalary` pays five parties from two inputs at once. When the employee owes withholding tax:

```
in 0  PayrollTreasury (ePHP)         out 0  net pay          -> employee
in 1  Employment NFT  (mutable)      out 1  SSS               (EE + ER + EC)
in 2+ fee UTXO(s)                    out 2  PhilHealth         (EE + ER)
                                      out 3  Pag-IBIG           (EE + ER)
                                      out 4  BIR                (withholding tax)
                                      out 5  Employment NFT, nextPeriod + 1 -> back to the vault
                                      out 6  treasury change    (the undisbursed ePHP remainder)
                                      out 7+ BCH change (optional)
```

A CashToken output carrying zero fungible units is **invalid under consensus**. Minimum-wage
earners are exempt from withholding tax under RA 9504, so a zero-tax employee is the *common*
case in a Philippine private payroll, not the edge case — and a zero-tax BIR output can't simply
carry `0`. It must not exist, so everything after it shifts up by one slot:

```
in 0  PayrollTreasury (ePHP)         out 0  net pay          -> employee
in 1  Employment NFT  (mutable)      out 1  SSS               (EE + ER + EC)
in 2+ fee UTXO(s)                    out 2  PhilHealth         (EE + ER)
                                      out 3  Pag-IBIG           (EE + ER)
                                      out 4  Employment NFT, nextPeriod + 1  ← was 5
                                      out 5  treasury change                 ← was 6
                                      out 6+ BCH change (optional)
```

[`outputLayoutFor(taxPerPeriod)`](src/domain/payroll/types.ts) is the one function that resolves
these indices; every other layer — the covenant, the frontend, the tests — calls it instead of
hardcoding `4`, `5`, `6`.

Every output's `lockingBytecode`, `tokenCategory` *and* `tokenAmount` are pinned individually —
pinning only two of the three is the classic covenant hole, since the right amount of the wrong
token, or the right token at the wrong address, would each still pass a partial check. The
Employment NFT's commitment is not checked field-by-field either; it is **rebuilt** from the
original byte slices with only `nextPeriod` replaced, so there is no field anyone forgot to
guard — a payroll run cannot touch a salary, a payee, an end date, or a status, no matter who
broadcasts it. Both token outputs that return to a contract (the NFT and the treasury change)
are additionally required to carry at least as many satoshis as they came in with — the fix for
an anonymous-broadcaster attack described in [`docs/judge-answers.md`](docs/judge-answers.md).

### The trust model, stated honestly

`PayrollTreasury` trusts the Employment NFT **category**, and nothing above it. Whoever holds
that category's minting baton can mint a record naming *any* `payeePkh` — so a live minting baton
is a treasury-equivalent key, able to direct funds to a forged employment record through a
perfectly lawful-looking payroll run. This was found by an adversarial security review of this
repo and confirmed on the VM: a forged record with the largest salary the 4-byte field holds
drained ₱9,997,775 in a single transaction.

It cannot be closed inside the covenant. The vault must be deployed *knowing* the treasury's
locking bytecode, so the treasury cannot symmetrically be deployed knowing the vault's — the
dependency is circular, and there is no `require()` that expresses "input 1 came from the vault".

**So it is closed procedurally instead, and that fix ships here.**
[`buildGenesisEmploymentTransaction`](src/infrastructure/blockchain/esahod/genesis.ts) mints every
employment record straight into the vault and **never re-outputs a minting-capability NFT**.
CashTokens minting authority cannot be recreated once a transaction spends it without reissuing
it, so after that one transaction confirms, no record of this category can ever be minted again by
anyone — HR included. [`tests/infrastructure/esahod/genesis.test.ts`](tests/infrastructure/esahod/genesis.test.ts)
proves all three parts: records land in the vault, the baton is verifiably gone afterwards, and —
the one worth reading — a `CONTRAST` case reproduces the naive "return the baton to HR for future
hires" pattern and shows the same forged-mint attack *succeeding* against it. The exploit and its
closure sit side by side in one file.

The residual boundary, stated plainly: if new hires must be enrollable *after* genesis, the baton
has to survive, and then this hole reopens. The correct extension is a baton held inside its own
covenant that can only emit NFTs whose `lockingBytecode` equals the vault — never a baton returned
to a plain key. See [`docs/judge-answers.md`](docs/judge-answers.md) for the full "compromised HR
key" answer.

## Quick start — the mock demo

Nothing below touches a network or real money. `npm run verify` runs the domain and covenant
compilation checks; the interactive demo is the frontend, which runs the real statutory engine
against an in-memory mock chain seeded with the two fixture employees.

```bash
git clone https://github.com/RobertAve1727/cashScript_hackathon_automatedPayroll.git
cd cashScript_hackathon_automatedPayroll
npm install
npm run contracts:compile   # .cash -> artifacts/*.json (already committed; this just re-proves it)
npm run verify               # tsc --noEmit + the test suite, all green
cd app
npm install
npm run dev                  # http://localhost:5173/#/treasurer
```

Six commands. Open the printed URL and use the nav to switch between `#/treasurer` (fund a
company, run payroll for either fixture employee or both, and watch the live 6/7-output
transaction diagram render — including the ghost row explaining the omitted BIR output),
`#/hr` (issue or amend an employment NFT and watch the 40-byte commitment hex re-encode live),
and `#/employee` (the reconciled payslip). Every number on every screen comes from
`computeDeductions`, `outputLayoutFor` and `encodeCommitment`/`decodeCommitment` in
`src/domain` — the exact functions the covenant and its tests are checked against, not a
frontend transcription of them.

## The chipnet path

The compiled artifacts in `artifacts/payroll_treasury.json` and `artifacts/employment_vault.json`
are real, deployable CashScript output — not mock-only stand-ins. `payroll_treasury.cash` is 533
bytes / 284 opcodes, past the historic 520-byte push limit, so it requires the May 2025 VM-limits
upgrade, which is active on both chipnet and mainnet.

**Honesty check:** the five scripts below are written and typecheck, but they have **not been run
against a real chipnet server** — nobody on this build has had a funded chipnet key yet. They are
the untested edge of this project, and [`scripts/esahod/lib/config.ts`](scripts/esahod/lib/config.ts)
says so at the top. Everything *upstream* of them — the statutory engine, the codec, both
covenants, the transaction builder, the attack suite — is proven against the real BCH VM. One
piece is independently verified without a network: `00-generate-keys.ts` was actually run, and its
WIF round-trip check passes.

```bash
npx tsx scripts/esahod/00-generate-keys.ts      # keeper / HR / officer WIFs + hash160s
# fund the keeper address at https://tbch4.googol.cash/ (select CHIPNET), then:
export ESAHOD_KEEPER_WIF=... ESAHOD_HR_WIF=... ESAHOD_OFFICER_WIF=...
export ESAHOD_SSS_PKH=... ESAHOD_PHIC_PKH=... ESAHOD_HDMF_PKH=... ESAHOD_BIR_PKH=...

npx tsx scripts/esahod/01-deploy.ts             # genesis-mint ePHP + the employment baton, derive both addresses
npx tsx scripts/esahod/02-enrol-employees.ts    # mint records into the vault AND burn the baton
npx tsx scripts/esahod/03-run-payroll.ts --employee-pkh <hex>
npx tsx scripts/esahod/04-amend.ts --employee-pkh <hex> --salary 40000
```

`01-deploy.ts` runs **two** genesis transactions, not one: a CashTokens category is the txid of
its transaction's first input, so two categories fundamentally require two distinct funding
UTXOs — the keeper needs at least two spendable coins before this will work. It writes every
derived value to `scripts/esahod/deployment.json`, which the later scripts read.

Run `02-enrol-employees.ts` in the same sitting as `01`. Between those two commands the minting
baton is live, and a live baton is a treasury-equivalent key (see [the trust
model](#the-trust-model-stated-honestly)); `02` is the step that destroys it.

`03-run-payroll.ts` needs **only a fee key** — not HR's, not the officer's. That is not an
oversight in the script; it is the covenant's permissionless design showing through. The employee
could run their own copy and get a byte-identical transaction.

`payroll_treasury.cash` is 533 bytes / 284 opcodes, past the historic 520-byte push limit, so it
requires the May 2025 VM-limits upgrade — active on both chipnet and mainnet.

## Reconciliation, to the centavo

Both fixture employees ([`src/domain/payroll/types.ts`](src/domain/payroll/types.ts)) are
computed by [`computeDeductions`](src/domain/statutory/deductions.ts) and independently
cross-checked by [`employerCost`](src/domain/statutory/deductions.ts) — a completely different
expression (gross pay plus every employer-side share) that is asserted equal to `totalDrawn` in
the tests rather than derived from it, so the cross-check shares no arithmetic with the number
it is checking.

**Fixture A — Maria Santos, Systems Analyst** (basic ₱35,000.00, allowance ₱2,000.00, tax
₱1,021.60 — compensation sits above the ₱35,000 SSS ceiling, so the SSS contribution caps):

| | Employee share | Employer share | To the agency |
|---|---:|---:|---:|
| SSS (MSC ₱35,000.00, capped) | ₱875.00 | ₱1,750.00 + ₱15.00 EC | **₱2,640.00** |
| PhilHealth | ₱437.50 | ₱437.50 | **₱875.00** |
| Pag-IBIG (MFS-capped) | ₱100.00 | ₱100.00 | **₱200.00** |
| BIR withholding | — | — | **₱1,021.60** |
| **Net pay to employee** | | | **₱16,065.90** |
| **Total drawn from treasury** | | | **₱20,802.50** |
| **Independent employer-cost cross-check** | | | **₱20,802.50** ✓ |

**Fixture B — Jun Dela Cruz, Warehouse Associate** (basic ₱16,000.00, no allowance, zero
withholding tax — below the ₱10,417 semi-monthly threshold, so the BIR output is omitted and
the NFT/change outputs shift from 5/6 to 4/5):

| | Employee share | Employer share | To the agency |
|---|---:|---:|---:|
| SSS (MSC ₱16,000.00) | ₱400.00 | ₱800.00 + ₱15.00 EC | **₱1,215.00** |
| PhilHealth | ₱200.00 | ₱200.00 | **₱400.00** |
| Pag-IBIG (MFS-capped) | ₱100.00 | ₱100.00 | **₱200.00** |
| BIR withholding | — | — | *(no output — RA 9504 exempt)* |
| **Net pay to employee** | | | **₱7,300.00** |
| **Total drawn from treasury** | | | **₱9,115.00** |
| **Independent employer-cost cross-check** | | | **₱9,115.00** ✓ |

Every peso figure above is `computeDeductions()` in centavos, converted for display only — the
golden centavo values (e.g. Fixture A net = `1606590`, Fixture B totalDrawn = `911500`) are
reproduced exactly in [`tests/domain/statutory.test.ts`](tests/domain/statutory.test.ts).

## Frontend

```bash
cd app
npm install
npm run dev
```

A self-contained Vite 7 + React 18 + TypeScript + Tailwind v4 app at [`app/`](app/), with
`@domain` aliased straight into `../src/domain` so the screens run the real statutory engine —
zero duplicated arithmetic. Three hash routes (`#/treasurer`, `#/hr`, `#/employee`) over a mock
chain gateway ([`app/src/chain/mock-chain-gateway.ts`](app/src/chain/mock-chain-gateway.ts))
seeded with ₱1,500,000.00 of ePHP and the two fixture employees.

**Wallet connect status, honestly:** [`app/src/wallet/cashaddr.ts`](app/src/wallet/cashaddr.ts)
is groundwork — a CashAddr decoder for turning an address a wallet like Paytaca hands over into
the 20-byte `payeePkh` the commitment carries — but no WalletConnect flow is wired up in this
snapshot, and there is no `VITE_WC_PROJECT_ID` or WalletConnect dependency to configure. Real
wallet connect is a roadmap item, not a shipped feature; see
[`docs/pitch-deck.md`](docs/pitch-deck.md).

## Legacy scaffold

Before eSahod, the first pass on this repo (PR #1) built a general-purpose clean-architecture BCH
payroll CLI: [`contracts/simple_bch_treasury.cash`](contracts/simple_bch_treasury.cash) (an
operator-signed `disburse`, rate-limited by `OP_CHECKSEQUENCEVERIFY`, plus a cold-key `reclaim`
escape hatch) and the full `src/` layered CLI (`npm run payroll -- employee:add ...`). It still
compiles, its own tests still pass, and both are folded into `npm run verify` — but it is a
**different contract with a different trust model** (an operator must sign every run; eSahod's
`paySalary` needs no signature at all), and `src/infrastructure/blockchain` still wires the CLI
to *that* contract, not to eSahod's `PayrollTreasury`/`EmploymentVault`. Running
`npm run payroll -- ...` demonstrates the PR #1 scaffold, not eSahod — eSahod's demo is the
frontend above, plus `src/domain` and its test suite. The two coexist in this repository on
purpose: eSahod is the hackathon deliverable, built on top of (and proving out) the
clean-architecture layering PR #1 established.

## Repository layout

```
contracts/                      the two eSahod covenants + the legacy simple_bch_treasury
artifacts/                      compiled output, committed — deployment never needs the compiler
scripts/compile-contracts.ts    the compiler entry point (npm run contracts:compile)
scripts/esahod/00-04            chipnet deployment lifecycle (written, not yet run on chipnet)

src/domain/                     zero dependencies — the specification everything else is checked against
  statutory/rates.ts               every statutory rate and bracket, in one file, with legal citations
  statutory/deductions.ts          computeDeductions() — the arithmetic the covenant mirrors character-for-character
  payroll/types.ts                 the 40-byte layout, output order + the zero-tax shift, the two fixtures
  payroll/commitment.ts            the 40-byte codec (encode/decode/hex helpers)
  entities/, value-objects/, …     the PR #1 domain model the legacy CLI runs on

src/application/                depends only on domain — use cases for the legacy CLI
src/infrastructure/blockchain/esahod/   the eSahod chain layer:
  addresses.ts                     deploys both covenants in the required order (treasury first)
  payroll-transaction.ts           assembles a paySalary transaction — no discretion, all amounts from the domain
  genesis.ts                       mint-to-vault + burn-the-baton (the forgery fix)
  p2pkh.ts                         locking bytecode from a bare 20-byte hash
src/infrastructure/             persistence and system adapters (+ the legacy CLI's chain gateway)
src/main/                       composition root + CLI entry point

app/                             the eSahod frontend (Vite + React), outside src/ and the dependency-rule test

docs/judge-answers.md           five questions a non-CashScript judge will ask, answered with file/line references
docs/pitch-deck.md              the pitch, one H2 per slide
```

## Testing

```bash
npm run typecheck   # tsc, strict
npm test            # vitest run — 315 tests
npm run verify       # both
```

**The covenant tests are the ones that matter.**
[`tests/infrastructure/esahod/`](tests/infrastructure/esahod/) (22 tests) loads the *compiled*
artifacts, builds real CashTokens transactions with `TransactionBuilder`, and lets libauth's BCH
VM evaluate every `require()` — no stubs anywhere in that path:

- **`pay-salary.test.ts`** — both fixtures pay out the golden numbers and are accepted by the VM;
  the zero-tax layout is proven separately; five consecutive periods run back to back (the literal
  demo choreography). Because the builder calls the *same* `computeDeductions` the covenant
  mirrors, a one-centavo drift between TypeScript and CashScript surfaces as `send()` throwing —
  not as a passing assertion on a hand-copied constant.
- **`attacks.test.ts`** — 13 attacks, each a valid transaction with exactly one mutation, each
  asserting the covenant's *own* `require()` message rather than just "it threw": redirect,
  period-not-advanced, tampered commitment, early claim, wrong category, suspended, ended
  employment, both halves of the BCH-strip pin, a genuine UTXO replay, an HR period rewind, a
  forged HR signature, plus one positive control.
- **`genesis.test.ts`** — the minting-baton fix, including a `CONTRAST` case that demonstrates the
  forgery attack succeeding against the naive alternative.

A single `send()` against a 284-opcode covenant takes several seconds of real VM evaluation, which
is why `vitest.config.ts` sets a 30-second `testTimeout`. That is a property of testing the real
thing rather than a stub, not flakiness.

`tests/architecture/dependency-rule.test.ts` parses every import in `src/` and fails the build if
an arrow points the wrong way: `domain` imports nothing at all, not even Node built-ins;
`application` imports only `domain`; CashScript/libauth are confined to `infrastructure`; only
`main` may import `infrastructure`. New chain-facing TypeScript belongs in
`src/infrastructure/blockchain/`, new scripts in `scripts/`, and frontend code in `app/` — which
sits outside `src/` and is exempt from that test by construction, since it never imports from
`src/infrastructure` or `src/application` at all.
