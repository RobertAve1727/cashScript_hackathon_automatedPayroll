# How eSahod works, end to end

This document explains what this project actually does, which parts run on the
Bitcoin Cash blockchain, which parts do not, and how a payroll flows from an
employee clocking in to money arriving at four government agencies.

It is written to be read by someone who did not build it. Where something is
proven, it says so and points at the proof. Where something is a mock or a
roadmap item, it says that too — a demo that overstates itself is worse than a
smaller demo that does not.

---

## Contents

- [1. The problem, precisely](#1-the-problem-precisely)
- [2. Why a blockchain is the right tool here](#2-why-a-blockchain-is-the-right-tool-here)
- [3. Where the blockchain actually is](#3-where-the-blockchain-actually-is)
- [4. The two covenants](#4-the-two-covenants)
- [5. The employment record: 40 bytes](#5-the-employment-record-40-bytes)
- [6. The payroll transaction, step by step](#6-the-payroll-transaction-step-by-step)
- [7. Attendance on chain](#7-attendance-on-chain)
- [8. Paying at any cadence, exactly](#8-paying-at-any-cadence-exactly)
- [9. The complete flow](#9-the-complete-flow)
- [10. What is real, what is mocked](#10-what-is-real-what-is-mocked)
- [11. The trust model, stated honestly](#11-the-trust-model-stated-honestly)
- [12. Running it yourself](#12-running-it-yourself)

---

## 1. The problem, precisely

The hackathon brief asks for automated, programmable salary distribution
without manual processing. That is the surface problem. Underneath it, in the
Philippine private sector, there is a sharper one.

Every payday an employer withholds four amounts from a worker's pay:

| Deduction | Legal basis | Goes to |
|---|---|---|
| SSS contribution | RA 11199 | Social Security System |
| PhilHealth premium | RA 11223 | PhilHealth |
| Pag-IBIG contribution | RA 9679 | HDMF |
| Withholding tax | RA 10963 (TRAIN) | BIR |

The worker sees these subtracted from their payslip immediately. The employer
is supposed to remit them to each agency **by the 10th of the following
month**. Those are two separate events, weeks apart, and only one of them is
visible to the worker.

When the second event does not happen, the worker has already paid. They find
out years later — at a loan application, a hospital admission, a retirement
claim — that the contributions credited to their name are missing. This is one
of the most common wage complaints in the country.

**The failure has a shape: a gap in time between deduction and remittance.**
Everything in this project follows from attacking that shape rather than the
symptom.

---

## 2. Why a blockchain is the right tool here

The point is not that the ledger is distributed. It is that a Bitcoin Cash
transaction is **atomic**: every output happens, or none does. There is no
state in which half a transaction occurred.

So if net pay and all four remittances are outputs of *the same transaction*,
the deduction and the remittance stop being two events. They become one event.
The gap that the failure lives in does not exist any more — not because it is
forbidden, but because it is **unrepresentable**.

That is the whole idea:

> eSahod does not make non-remittance illegal. It makes it geometrically
> impossible, because there is no state in which the deduction happened and
> the remittance did not.

A database cannot make that claim. A database with excellent controls can
still be edited by whoever holds the credentials.

---

## 3. Where the blockchain actually is

Three layers, and it matters which is which.

```
┌─────────────────────────────────────────────────────────────────┐
│  ON CHAIN — enforced by Bitcoin Cash consensus                  │
│                                                                 │
│  contracts/payroll_treasury.cash     533 bytes, 284 opcodes     │
│  contracts/employment_vault.cash      55 bytes,  41 opcodes     │
│                                                                 │
│  These are COVENANTS. They do not "hold" logic that someone     │
│  runs — they are conditions the network refuses to accept a     │
│  transaction without satisfying.                                │
└─────────────────────────────────────────────────────────────────┘
              ▲ builds transactions that satisfy the above
┌─────────────────────────────────────────────────────────────────┐
│  OFF CHAIN, SHARED — plain TypeScript, zero dependencies        │
│                                                                 │
│  src/domain/statutory/     the contribution + tax arithmetic    │
│  src/domain/payroll/       the 40-byte record codec, layouts    │
│  src/domain/attendance/    time records, the punch codec        │
│                                                                 │
│  This computes the SAME numbers the covenant enforces. It is    │
│  the specification both sides are checked against.              │
└─────────────────────────────────────────────────────────────────┘
              ▲ imported directly, never re-implemented
┌─────────────────────────────────────────────────────────────────┐
│  THE APP — what a person sees                                   │
│                                                                 │
│  app/  Employee, HR and Payroll Officer screens                 │
└─────────────────────────────────────────────────────────────────┘
```

The important architectural fact: **the app imports the domain layer
directly** (`@domain` aliases into `../src/domain`). The peso figure on an
employee's payslip is produced by the same `computeDeductions` call the
covenant's tests are run against. There is no second copy of the arithmetic to
drift out of sync.

### File map

| What | File |
|---|---|
| Treasury covenant | [contracts/payroll_treasury.cash](../contracts/payroll_treasury.cash) |
| Vault covenant | [contracts/employment_vault.cash](../contracts/employment_vault.cash) |
| Statutory arithmetic | [src/domain/statutory/deductions.ts](../src/domain/statutory/deductions.ts) |
| 40-byte record codec | [src/domain/payroll/commitment.ts](../src/domain/payroll/commitment.ts) |
| Builds the payroll transaction | [src/infrastructure/blockchain/esahod/payroll-transaction.ts](../src/infrastructure/blockchain/esahod/payroll-transaction.ts) |
| Mints records, burns the baton | [src/infrastructure/blockchain/esahod/genesis.ts](../src/infrastructure/blockchain/esahod/genesis.ts) |
| Anchors attendance | [src/infrastructure/blockchain/esahod/attendance-anchor.ts](../src/infrastructure/blockchain/esahod/attendance-anchor.ts) |
| Chipnet deployment scripts | [scripts/esahod/](../scripts/esahod/) |

---

## 4. The two covenants

A **covenant** is a contract that constrains what a transaction spending it is
allowed to look like. Not "who may spend this" — *what shape the result must
have*.

### PayrollTreasury

Holds one company's payroll funding for one cycle, denominated in **ePHP**: a
fungible CashToken where 1 unit is fixed at 1 centavo.

Its money-moving path is `paySalary`, and it requires **no signature at all**.
Anyone may broadcast it. That sounds alarming and is the opposite:

> If the transaction can only take one shape, then permission to trigger it is
> worthless. The payroll officer cannot redirect a peso, because every payee
> address and every amount is pinned by the covenant, computed from the
> employee's own record.

A role with no discretion needs no trust. That is why the Treasury screen's
button says "permissionless, no signature".

Its other path, `sweepLapsedNca`, returns unspent funding to the company after
`lapseTime`, and requires the payroll officer's signature. Before that time it
is dead — the officer cannot recall money an employee is still owed.

### EmploymentVault

Where an employee's record NFT lives between paydays. Two paths:

- `payroll()` — anyone may trigger, but only if **input 0 is this specific
  deployed treasury**. This is the reverse guarantee. Without it, the record
  would unlock for any transaction, and an attacker could pair it with a
  look-alike contract that advances the pay-period counter and pays nobody.
  Do that 24 times and a worker's whole year reads as paid on chain while
  their wallet stays empty.
- `amend()` — HR-signed. The only way to edit a record. It refuses to let the
  period counter move **backwards**, which is what stops a stolen HR key from
  reopening periods that were already paid.

**Neither covenant is sufficient alone.** The treasury stops a forged record
from being paid; the vault stops a genuine record from being paid by a forged
treasury.

---

## 5. The employment record: 40 bytes

Each employee is a **mutable CashToken NFT**. CashTokens allows an NFT to
carry a 40-byte commitment, and the layout uses every byte
([src/domain/payroll/types.ts](../src/domain/payroll/types.ts)):

| Field | Offset | Bytes | Meaning |
|---|---:|---:|---|
| `payeePkh` | 0 | 20 | The employee's wallet hash |
| `monthlyBasic` | 20 | 4 | Monthly basic salary, centavos |
| `monthlyAllowance` | 24 | 4 | Allowances forming part of compensation |
| `taxPerPeriod` | 28 | 4 | Withholding tax HR computed |
| `nextPeriod` | 32 | 2 | Monotonic counter — the anti-double-payment mechanism |
| `endPeriod` | 34 | 2 | Last payable period |
| `status` | 36 | 1 | 1 active, 0 suspended/separated |
| `employeeNo` | 37 | 3 | Company employee number |

**This record is the employment contract.** The salary is not in a database
that points at a token; it is *in* the token.

A real one, from the demo, decodes like this:

```
9c1d3f5a…4c6d8e  e0673500  400d0300  108f0100  0100  1800  01  e90300
└─ payeePkh ──┘  └ basic ┘  └ allow ┘  └ tax ─┘  └nxt┘ └end┘ └s┘ └ no ┘
                 ₱35,000    ₱2,000    ₱1,021.60    1    24  active #1001
```

Turn on **Proof view** in the app header to see this under every employee.

> **Why the payee lives inside the commitment.** Because it does, the covenant
> can verify the payment target without anyone telling it who to pay. That is
> exactly what makes handing the trigger to the public safe.

---

## 6. The payroll transaction, step by step

This is the centre of the project. One employee, one period, one transaction.

```
INPUTS                              OUTPUTS
────────────────────────────        ─────────────────────────────────────
0  PayrollTreasury (ePHP)     →     0  net pay            → employee wallet
1  Employment NFT (mutable)   →     1  SSS   (EE+ER+EC)   → SSS address
2+ fee UTXO(s)                →     2  PhilHealth (EE+ER) → PhilHealth
                                    3  Pag-IBIG   (EE+ER) → HDMF
                                    4  BIR (withholding)  → BIR
                                    5  Employment NFT, period+1 → vault
                                    6  treasury change    → treasury
                                    7+ BCH change (optional)
```

Every one of those outputs is **pinned by the covenant** — its address, its
token category *and* its amount. Pinning only two of the three is the classic
covenant hole: the right amount of the wrong token, or the right token at the
wrong address, would each pass a partial check.

### What the covenant checks, in order

1. **This is input 0.** The treasury pins its own position.
2. **Input 1 is a mutable NFT of the company's employment category.** This is
   the trust root — see §11.
3. **The employee is active and not past their end period.**
4. **Payday has arrived.** `tx.time >= genesisTime + period × periodSeconds`,
   which compiles to `OP_CHECKLOCKTIMEVERIFY`.
5. **The statutory arithmetic**, recomputed on chain from the commitment's own
   bytes — the MSC bracket, the PhilHealth floor and ceiling, the Pag-IBIG
   maximum fund salary, and net pay.
6. **Each output**, address + category + amount.
7. **The returned NFT** is rebuilt from the original bytes with only
   `nextPeriod` replaced. Not checked field by field — *reconstructed* — so
   there is no field anyone forgot to guard.
8. **Satoshi floors**, so an anonymous broadcaster cannot strip the BCH riding
   on the treasury or the record while performing an otherwise lawful run.

### The zero-tax case

A CashToken output carrying **zero units is invalid under consensus**.
Minimum-wage earners are exempt from withholding tax under RA 9504, so a
zero-tax employee is the *common* case in a Philippine payroll, not an edge
case. The BIR output cannot carry `0` — it must not exist, and everything
after it shifts up one slot:

```
out 4  Employment NFT      ← was 5
out 5  treasury change     ← was 6
```

[`outputLayoutFor(taxPerPeriod)`](../src/domain/payroll/types.ts) is the single
function that resolves these indices. The covenant, the transaction builder
and the UI all call it rather than hardcoding `4`, `5`, `6`.

### Anti-double-payment

`nextPeriod` only ever increases, and the covenant will not accept a
transaction that fails to advance it. Period 5 can be claimed exactly once,
ever. Not "we check for duplicates" — the second attempt is not a valid
transaction.

---

## 7. Attendance on chain

A payroll covenant can prove it paid the right person the right amount. It
**cannot know whether the day was worked**. That answer has to come from
somewhere, and in an ordinary HRIS it is a row in the employer's database that
the employer can edit — "the system says you were absent" ends the argument.

So every clock-in and clock-out is written to the chain as a 13-byte
`OP_RETURN` at the moment it happens:

```
6553 4844   01        01      e90300        5cc16d6a
'eSHD'      version   in      employee      unix timestamp
                              #1001         (little-endian)
```

`OP_RETURN` because attendance is a **log, not money**: the output is provably
unspendable, so it adds nothing to the UTXO set anyone must carry forever, it
is timestamped by the block that confirms it, and it needs no new covenant.

**Where a punch lives before it is anchored.** The tap writes a row to
`attendance_punches` immediately; the anchor transaction follows when someone
with a key broadcasts it. That table is append-only, and enforced by trigger
rather than only by policy — which matters, because the `service_role` key
bypasses row-level security and does **not** bypass triggers. A punch cannot be
edited or deleted by any key in this project; a correction is a new punch,
which is visible. The day an employee worked (`attendance_records`) is a
projection a trigger maintains from those punches, and no client may write it,
so nobody can assert a day their own punches contradict.

**What this guarantees:** the record is tamper-evident. A punch, once
confirmed, cannot be edited or backdated, and its absence is as visible as its
presence.

**What it does not:** that the punch is honest. Whoever holds the broadcasting
key can anchor a day nobody worked. Making the *payout* conditional on
attendance would need the covenant to read an attendance record, which needs a
second covenant and commitment bytes the full 40-byte record does not have.
That boundary is real and is stated rather than implied away.

---

## 8. Paying at any cadence, exactly

The brief asks for payments on "predefined schedules". Article 103 of the
Labor Code requires wages at least twice a month at intervals not exceeding 16
days — that is a **floor, not a fixed cadence**. Monthly-only is unlawful;
weekly or daily is perfectly legal.

But SSS, PhilHealth and Pag-IBIG are **monthly** obligations with published
brackets, remitted by the 10th of the following month. Whatever cadence a
company picks, what reaches each agency at month end must be that bracket
**exactly**.

Naive division breaks this. ₱1,750.00 of SSS across 22 working days is
₱79.5454… a day; truncated to ₱79.54 and paid 22 times, the month closes at
₱1,749.88 — **₱0.12 short, every month, of money already withheld from a
payslip.** A daily payroll that divides the obvious way reintroduces the exact
failure this project exists to prevent.

[`allocation.ts`](../src/domain/statutory/allocation.ts) splits by running
total instead:

```
due(k) = floor(monthly × k / periods) − floor(monthly × (k−1) / periods)
```

The sum telescopes to exactly `monthly`, for any number of periods, with no
accumulator to carry and no remainder stranded on the last day. The indivisible
centavo lands on a real period instead of being dropped.

**See it:** sign in as HR → **Pay Schedule** → pick *Daily*. Twenty-two
periods of ₱79.54/₱79.55 summing to ₱1,750.00, with a difference column that
reads 0.00 for every fund.

> **The honest caveat, which the screen also shows.** The deployed covenant
> hardcodes the semi-monthly divisor (`msc * 5 / 200`, `gross =
> monthlyCompensation / 2`). Its `periodSeconds` parameter controls only *when*
> a period becomes claimable, not how much it pays — deploying it with 86400
> would pay half a month's salary every day. Switching cadence on chain is a
> redeploy with two changed constants, not a flag. The engine computes every
> cadence correctly today; only semi-monthly is settled on chain.

---

## 9. The complete flow

### Setup, once per company

**① Deploy** — [01-deploy.ts](../scripts/esahod/01-deploy.ts)

Two CashToken categories are created: ePHP, and the employment category. A
category id *is* the txid of the transaction that created it, so two distinct
categories need two distinct genesis transactions — each spending a different
funding UTXO, and each of those UTXOs must sit at **output index 0**, because
consensus derives the category from a vout-0 outpoint. Both contract addresses
are then derived and written to `deployment.json`.

**② Enrol** — [02-enrol-employees.ts](../scripts/esahod/02-enrol-employees.ts) →
[genesis.ts](../src/infrastructure/blockchain/esahod/genesis.ts)

Every employment record is minted **straight into the vault**, and the minting
authority is **destroyed in the same transaction**.

That last part is not housekeeping, it is the security model. CashTokens
minting authority can only be reduced, never recreated — a transaction that
spends the minting UTXO without re-emitting one destroys it permanently. After
genesis nobody, HR included, can ever mint another record of that category.

**③ Funding** — the company sends ePHP to the treasury address.

### Every period

**④ Employee clocks in** → 13-byte `OP_RETURN` anchored (§7).

**⑤ Payroll runs** — anyone broadcasts `paySalary` (§6). Five parties are paid
in one atomic transaction. The record returns to the vault with its counter
advanced by one.

**⑥ Employee reads the payslip** — every figure computed by the same engine
the covenant enforces, with the reconciliation shown two independent ways.

### When something changes

**⑦ HR amends** — a salary change, a suspension, a separation, a corrected tax
figure. HR signs; the covenant refuses to let the period counter go backwards.

**⑧ Cycle ends** — after `lapseTime` the officer sweeps the remainder back to
the company, and a fresh treasury is deployed for the next cycle.

### As a sequence

```
HR                    CHAIN                          EMPLOYEE
──                    ─────                          ────────
genesis  ──────────▶  mint records → vault
                      burn minting baton
                      (forgery now impossible)

fund     ──────────▶  treasury holds ePHP

                      ◀────────────────────────────  clock in
                      OP_RETURN anchored

         anyone ────▶ paySalary
                      ├─ net pay ────────────────▶   wallet
                      ├─ SSS ──────────▶ agency
                      ├─ PhilHealth ───▶ agency
                      ├─ Pag-IBIG ─────▶ agency
                      ├─ BIR ──────────▶ agency
                      └─ NFT period+1 → vault

amend    ──────────▶  HR-signed, counter never rewinds
```

---

## 10. What is real, what is mocked

**Read this section before demoing.** Overstating any row of it is the fastest
way to lose credibility with someone who reads the code.

| Component | Status |
|---|---|
| Both covenants compile | **Real.** `cashc` 0.13.2 → 533 and 55 bytes |
| Covenant logic | **Proven against the real BCH VM.** libauth's VM via `MockNetworkProvider`, not a stub |
| Statutory arithmetic | **Real**, and matched character-for-character against the covenant's |
| Attack suite | **Real.** Each case builds a valid transaction with one deliberate mutation and asserts the exact `require()` message |
| Attendance anchor | **Real** transaction builder, VM-accepted, decoded back out of the broadcast bytes in tests |
| Chipnet deployment | **Real and done.** Genesis, enrolment and one payroll broadcast; txid `fa4e036c01b3296185abe39bdfd05a00621670b2e7cfef7a8cfa31c23855a916` paid five parties atomically |
| The app's chain data | **Real when configured.** [chipnet-gateway.ts](../app/src/chain/chipnet-gateway.ts) reads live UTXOs at the deployed covenant addresses |
| The app **writing** to chain | **Real.** "Run payroll" in the browser broadcasts to chipnet through the [keeper relay](../scripts/esahod/keeper-relay.ts). Verified: txid `79f8e66e890de72dd3bb6e7b99b6f426bb95a52a038ac0b515e3e3cf34350fc4` |
| Issuing a new employment NFT | **Demo chain only, permanently.** The minting baton was destroyed at genesis — that is the forgery protection, so no new record can ever be minted on chain |
| Sign-in | **Real when configured.** Supabase auth with row-level security deciding what the session may read; falls back to bundled fixtures offline |
| Attendance punches | **Stored, not yet anchored.** Append-only rows in Postgres — a trigger refuses edits and deletes, so not even the service_role key can rewrite one. The 13 bytes are the real `encodePunch` output; `anchor_tx_id` stays null until someone with a key broadcasts it |
| Daily/weekly cadence | **Engine-ready, not chain-settled.** HR can set it per employee and the engine, reconciliation and payday clock all follow. The deployed covenant still settles semi-monthly. See §8 |
| BCMR token metadata | **Written, not published** |

Total: **389 tests passing** across 23 files.

The honest one-line summary:

> The covenants are proven to enforce what we claim, against the real virtual
> machine, and they are deployed on chipnet. The frontend both reads and writes
> that chain: payroll is broadcast from the browser through a keeper service
> that holds only a fee key — it cannot redirect a peso, because the covenant
> pins every payee and every amount.

---

## 11. The trust model, stated honestly

Every system has a trust root. Naming yours is the difference between a
security claim and a sales pitch.

**The root is the employment token category.** `paySalary` trusts that input 1
is a mutable NFT of the company's category, and nothing above it. Whoever can
mint that category can mint a record naming any payee with any salary, and
have it paid through a perfectly lawful-looking run.

**Why the covenant cannot close this itself:** a covenant comparing a category
can distinguish a *category*, never a *record*. Pinning the vault's address in
the treasury would not help either — a forged record minted **into** the vault
is paid exactly like a genuine one. This is VM-proven in
[genesis.test.ts](../tests/infrastructure/esahod/genesis.test.ts), where such a
record drains 60% of a treasury in a single period.

**So the fix is procedural, at genesis:** mint everything into the vault and
destroy the minting authority in the same transaction (§9②). After that, the
hole is not guarded — it is *gone*, because the capability to mint no longer
exists.

**The residual boundary:** if new hires must be enrollable after genesis, the
baton has to survive, and then this reopens. A baton covenant would have to
constrain **what** is minted — a commitment pre-committed by a separate key,
or co-signed by the employee — not merely where the NFT lands.

### What is guaranteed, and what is not

| Guaranteed by the chain | Not guaranteed |
|---|---|
| Deduction and remittance are the same event | That a clocked-in day was actually worked |
| A period can be paid at most once | That HR's withholding tax figure is correct |
| Nobody can redirect a payment, including the officer | That the company funds the treasury at all |
| Amounts follow SSS/PhilHealth/Pag-IBIG law exactly | Anything, if the minting baton survives genesis |
| An amendment cannot reopen a paid period | |

Withholding tax deserves its own note: real withholding is annualised and
depends on substituted filing, year-to-date compensation and the taxability of
specific allowances. HR computes it off chain; the chain enforces **that exact
number to exactly the BIR address**. Knowing where that line sits — enforcing
what is verifiable and refusing to pretend about the rest — is the point.

---

## 12. Running it yourself

```bash
npm install
npm run contracts:compile     # cashc → artifacts/
npm run verify                # typecheck + 389 tests
npm run esahod:live           # relay + app together, writing to chipnet
npm run esahod:state          # treasury balance and every record, from chain
cd app && npm install && npm run dev
```

Open the printed URL. Sign in with any demo account — password `esahod2026`:

| Account | Role | What to look at |
|---|---|---|
| `ben.aquino@esahod.ph` | Payroll Officer | Run payroll, watch the output diagram render |
| `rosa.villanueva@esahod.ph` | HR | Issue a record, amend one, open **Pay Schedule** and pick Daily |
| `maria.santos@esahod.ph` | Employee | Clock in, then read the payslip |

Flip **Proof view** in the header to reveal the 40-byte commitments,
`OP_RETURN` payloads and anchor transactions behind every figure.

### The three things worth showing

1. **The output diagram** on the Treasury screen after a run — five parties
   paid in one transaction, with the BIR row visibly absent for the
   zero-tax employee.
2. **Pay Schedule → Daily** — 22 periods that sum to the published monthly
   bracket exactly, difference column all zeros.
3. **Proof view on, then amend a salary** — the byte diff shows what changed
   *and* that nothing else did.

### Deploying to chipnet

The scripts in [scripts/esahod/](../scripts/esahod/) are written for this and
have never been run. They need chipnet coins from a faucet, and `01-deploy`
specifically needs two funding UTXOs **at output index 0**, because a
CashTokens category id is the txid of a vout-0 outpoint. Read the script's own
comments before running it.
