# Where the chain is

Every place this project touches Bitcoin Cash, and — just as important — every
place it deliberately does not.

Checked against the repository and the live chipnet deployment, 2 August 2026.

---

## 1. The two covenants

The chain is not a database this project writes to. It is an **enforcer**: the
rules live in script, and the network refuses transactions that break them.

| Contract | Size | What it holds | Paths |
|---|---|---|---|
| [payroll_treasury.cash](../contracts/payroll_treasury.cash) | 549 B, 297 opcodes | the company's ePHP | `paySalary`, `sweepLapsedNca` |
| [employment_vault.cash](../contracts/employment_vault.cash) | 55 B, 41 opcodes | every employment NFT | `payroll`, `amend` |

`simple_bch_treasury.cash` is a teaching example and is not part of the payroll
system.

### What each path enforces

**`paySalary`** — permissionless, no signature. Pins the address, token category
AND amount of all seven outputs, computes every statutory figure from the
employee's own record, and refuses:

| | message |
|---|---|
| paying anyone but the payee in the record | `output 0 must pay the employee named in the record` |
| changing any field but the counter | `only nextPeriod may change, and only by +1` |
| claiming before payday | `payday for this period has not arrived` |
| a record past its window | `employment record has ended` |
| a treasury that is not this company's | `input 0 is not this company's payroll treasury` |
| stripping the treasury's BCH as fees | `the treasury must keep its satoshis` |

**`amend`** — HR-signed. Constrains exactly two things: the record keeps its
category and mutable capability, and `nextPeriod` never moves backwards. Salary,
tax, status and `endPeriod` all move freely, which is what makes renewal and
separation possible. See [renewal.test.ts](../tests/infrastructure/esahod/renewal.test.ts).

**`sweepLapsedNca`** — officer-signed, after `lapseTime`. Returns unspent
funding so a fresh treasury can be funded for the next cycle. The one path never
exercised on a live chain: its lapse time is years out.

---

## 2. What is stored on chain

### The employment record — a mutable CashToken NFT, 40 bytes

Not a database row pointing at a token. **The salary is in the token.**

```
[0:20]  payeePkh          the wallet that gets paid
[20:24] monthlyBasic
[24:28] monthlyAllowance
[28:32] taxPerPeriod      HR computes, the chain enforces
[32:34] nextPeriod        anti-double-payment
[34:36] endPeriod         contracts expire on their own
[36:37] status
[37:40] employeeNo
```

Every byte is allocated. That is why pay cadence, names and attendance live
off chain — there is no room, and the covenant splits and rebuilds the
commitment at fixed offsets, so adding a field would make every existing NFT
unspendable.

### The treasury — fungible ePHP

1 unit = 1 centavo, company-issued, never touching BCH's price. BCH is only the
fee.

### Two token categories, both destroyed as authorities at genesis

The employment category's **minting baton was burned** in the same transaction
that created the records. No new employment NFT can ever be minted — that is
what stops an employer forging one, and it is why issuance in the app writes to
the demo chain only.

---

## 3. Every transaction this system broadcasts

| # | What | Built by | Broadcast by |
|---|---|---|---|
| 1 | ePHP category genesis | [genesis.ts](../src/infrastructure/blockchain/esahod/genesis.ts) | `01-deploy.ts` |
| 2 | employment category genesis | genesis.ts | `01-deploy.ts` |
| 3 | enrol employees + **burn the baton** | genesis.ts | `02-enrol-employees.ts` |
| 4 | **payroll** — 7 outputs, 5 parties | [payroll-transaction.ts](../src/infrastructure/blockchain/esahod/payroll-transaction.ts) | `03-run-payroll.ts`, `keeper-relay.ts`, `payroll-daemon.ts` |
| 5 | amendment | inline | `04-amend.ts`, `keeper-relay.ts` |
| 6 | attendance anchor (OP_RETURN) | [attendance-anchor.ts](../src/infrastructure/blockchain/esahod/attendance-anchor.ts) | *not yet broadcast* |
| 7 | BCMR metadata | `05-publish-bcmr.ts` | *not yet broadcast* |
| 8 | lapse sweep | inline | *lapse time is years away* |

### The payroll transaction, in full

```
INPUTS                          OUTPUTS
0  PayrollTreasury (ePHP)   →   0  net pay        → employee
1  Employment NFT           →   1  SSS            (EE + ER + EC)
2+ fee UTXO(s)              →   2  PhilHealth     (EE + ER)
                                3  Pag-IBIG       (EE + ER)
                                4  BIR            (withholding)
                                5  NFT, period+1  → back to vault
                                6  treasury change
```

The deduction and the remittance are the same event. There is no state of the
chain in which one happened and the other did not.

---

## 4. How the app reaches the chain

### Reads — direct

[chipnet-gateway.ts](../app/src/chain/chipnet-gateway.ts) queries live UTXOs at
the two covenant addresses over ElectrumNetworkProvider, polling every 10
seconds:

- treasury balance ← UTXOs at the treasury address, filtered by ePHP category
- the roster ← mutable NFTs at the vault address, commitments decoded

### Writes — through the keeper relay

`paySalary` needs no signature, but the transaction needs a **fee input**, and
the covenant forbids funding it from the treasury or the NFT. Fee inputs are
ordinary coins that must be signed, and the browser is the wrong place for a
key. So [keeper-relay.ts](../scripts/esahod/keeper-relay.ts) holds it.

**What that key can do is bounded by the covenant, not by trusting the relay.**
Every payee, category and amount is pinned. Steal the key and you waste a
fraction of a centavo in fees; compromise the whole service and you can refuse
to pay someone, or pay a different employee than was asked — you still cannot
change who gets paid or how much.

HR's key is different, and treated differently: it rewrites pay terms, so
`/amend` is opt-in and the relay declares which keys it holds on `/health`.

### The payday clock

`genesisTime` and `periodSeconds` are **constructor arguments**, so they belong
to the treasury and are part of its address. The app reads them from
`deployment.json` through `VITE_ESAHOD_*` so the screen and the chain compute
the same answer. An employee's HRIS cadence decides *which* treasury pays them,
not how fast this one's clock ticks.

---

## 5. What is NOT on chain, and why

| | Where it lives | Why not on chain |
|---|---|---|
| Names, departments, emails | Supabase | No room in 40 bytes |
| Attendance punches | Supabase, append-only | Anchor transaction not yet broadcast |
| Overtime requests + approvals | Supabase | A decision is an HRIS record; only its effect is money |
| Pay cadence | Supabase | Property of the treasury, not the employee |
| Premiums (Art. 86/87/91–94) | computed only | The covenant has no premium field |
| Payslip history | reconstructable | Would mean walking the address's tx history |

**Attendance is the one worth stating precisely.** The punch is recorded the
moment it happens, append-only and enforced by database trigger — the
`service_role` key bypasses row-level security and does **not** bypass triggers,
so no key in this project can edit or delete one. A correction is a new punch.
The 13 bytes are real `encodePunch` output. What has not happened yet is the
broadcast.

Gating pay on attendance is not a small step: `OP_RETURN` outputs are provably
unspendable, so a covenant cannot consume one as an input. It needs a second
covenant and commitment bytes that do not exist.

---

## 6. The live deployment

```
treasury    bchtest:pv7hjzqu3aytkrg863szw36fr02v34r8epsl5ny3mgkhm79dls4372x0xet53
vault       bchtest:pvh2vvyte34p02uccc90l37rna000z57vhmwjmkjr25j6seqn7c8gzpxqtv7g
ePHP        412ba936e7924d708fff27987503f7c0f26b8b04dd8aff3340c022f37095824d
employment  8f6b96a033b14392beaed59a0d601c66f6694d7376f917d90c468e7b59e621ff
genesisTime 1779064746        periodSeconds 1314873      periodsPerMonth 2
```

Payroll broadcast from the browser:
`6437bf67bad2911d04560e916450d8fba6dcb3b18c9a3ed6c646593b95310a71`

Changing `periodsPerMonth` changes the treasury's address, so **one treasury
settles one cadence**. A company paying weekly and semi-monthly funds two.

---

## 7. How the chain rules are proved

**430 tests**, run against libauth's real Bitcoin Cash VM through
`MockNetworkProvider` — not a stub.

| Suite | Proves |
|---|---|
| [attacks.test.ts](../tests/infrastructure/esahod/attacks.test.ts) | 19 attacks, each a valid transaction with one mutation, rejected **by name** |
| [genesis.test.ts](../tests/infrastructure/esahod/genesis.test.ts) | the minting baton is destroyed and cannot be recreated |
| [cadence.test.ts](../tests/infrastructure/esahod/cadence.test.ts) | weekly and daily treasuries settle correctly |
| [renewal.test.ts](../tests/infrastructure/esahod/renewal.test.ts) | expiry stops payment; an amendment restores it; a rewind does not |

A deployed contract proves you sent a transaction. These prove the contract
**refuses** the ones that should not exist.
