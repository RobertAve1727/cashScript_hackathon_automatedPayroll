## eSahod

**Automated Philippine private-sector payroll on Bitcoin Cash.**

The deduction and the remittance are the same event. Not reconciled later, not promised for
later — the same Bitcoin Cash transaction. If the employee got paid, SSS, PhilHealth and
Pag-IBIG already got paid too, because the covenant refuses to let one happen without the
others.

Built on CashTokens: one fungible ePHP token (1 unit = 1 centavo) as the payroll funding, one
mutable NFT per employee as their employment record, two CashScript covenants enforcing every
peso between them.

---

## The problem

A Philippine private-sector payslip shows SSS, PhilHealth and Pag-IBIG deducted this cut-off.
That line item is a *promise*, not a receipt. The money leaves the employee's gross pay
immediately; whether it reaches the agency is a separate, later, manually-triggered transfer —
and non-remittance of contributions already withheld from workers is one of the most common
labor complaints filed in the Philippines. It is invisible to the worker for months, because the
only place it becomes visible is the moment they need those contributions to exist: a maternity
claim, a salary loan, a pension computation — and find out the employer kept deducting long after
they stopped remitting.

The gap isn't fraud in every case. It's structural: nothing forces the deduction and the
remittance to be the same event, so an employer under cash-flow pressure can quietly let them
drift apart, one payroll cycle at a time, with no invalid transaction anywhere for an auditor to
catch.

---

## Why alternatives fall short

| Approach | What it fixes | What it doesn't |
|---|---|---|
| Spreadsheet + bank transfer (today's norm) | Nothing structurally | Deduction and remittance are two manual steps, minutes to months apart, reversible by one person |
| Payroll SaaS / fintech app | Faster, fewer typos | Still a database an admin can edit unilaterally; "remitted" is a status flag, not a settlement fact |
| Pay net salary in a stablecoin | Faster employee payout | Doesn't touch the actual problem — statutory remittance is still a separate step, still days later |
| Generic salary-streaming contract | Trustless net pay, continuously | No concept of a five-party statutory disbursement; not built for this shape at all |

Every one of these can fail exactly the way today's payroll fails: pay the worker, quietly skip
the remittance, and nothing on the ledger says so. eSahod's covenant has no code path in which
that transaction is valid.

---

## Architecture — two covenants, one atomic transaction

**`PayrollTreasury`** holds a company's ePHP funding for one payroll cycle. Its `paySalary` path
needs **no signature** — anyone can broadcast it — because every recipient and every amount is
derived from data the transaction carries in, never chosen by whoever hits the button.

**`EmploymentVault`** is where an employment record NFT lives between paydays. `payroll()`
(anyone) lets the treasury spend a record only if it's genuinely paired with *that* treasury.
`amend()` (HR-signed) is the only way to edit a record — and it can suspend, separate, or
correct a salary, but it can never move the pay-period counter backwards.

```
PayrollTreasury.paySalary()  ──requires──▶  input 1 is a genuine Employment NFT
EmploymentVault.payroll()    ──requires──▶  input 0 is genuinely THIS treasury
```

Neither guarantee exists without the other, and both are enforced by consensus, not by policy.

---

## The employment commitment — 40 bytes

CashTokens caps an NFT commitment at 40 bytes. Every one of them is spoken for:

| Bytes | Field | Why it's there |
|---:|---|---|
| 0–19 | `payeePkh` | Lives in the data, not a contract parameter — the reason triggering payroll is safe to give away |
| 20–23 | `monthlyBasic` | PhilHealth's base |
| 24–27 | `monthlyAllowance` | Added to basic for SSS and Pag-IBIG |
| 28–31 | `taxPerPeriod` | HR-computed, chain-enforced to the exact BIR address |
| 32–33 | `nextPeriod` | The anti-double-payment counter — never moves backwards |
| 34–35 | `endPeriod` | Fixed-term contracts expire on their own |
| 36 | `status` | 1 active, 0 the covenant refuses to pay |
| 37–39 | `employeeNo` | The audit trail |

---

## The payroll transaction — 6 or 7 outputs

**Taxed employee, 7 outputs:**
`0 net → employee · 1 SSS · 2 PhilHealth · 3 Pag-IBIG · 4 BIR · 5 NFT (period+1) · 6 change`

**Zero-tax employee, 6 outputs — RA 9504 minimum-wage exemption, the common case, not the edge
case:**
`0 net → employee · 1 SSS · 2 PhilHealth · 3 Pag-IBIG · 4 NFT (period+1) · 5 change`

A CashToken output carrying zero units is invalid under consensus — the BIR output can't just
carry `0`, it has to not exist, and everything after it shifts up one slot. Every output's
address, token category *and* amount are checked individually; the NFT is not diffed
field-by-field, it is *rebuilt* with only the period advanced, so no field is ever left
unguarded by omission.

---

## Live demo — run sheet

1. **Treasurer screen** — the funded treasury: ₱1,500,000.00 of ePHP, minted once.
2. **HR screen** — Maria Santos's commitment hex, byte-highlighted. `payeePkh` sits at byte 0.
3. **Run Payroll, Maria** — the live 7-output diagram renders; every figure matches the
   reconciliation table to the centavo.
4. **Run Payroll, Jun** — the live 6-output diagram renders, ghost row where BIR would sit,
   RA 9504 explained inline.
5. **Run All** — both employees paid in one sweep; the treasury balance drops by exactly the
   total drawn.
6. **Employee screen** — the reconciled payslip, computed by the exact function that just ran.
7. **Suspend Jun, then try to pay him** — the run is refused: *"suspended — the covenant refuses
   status 0."* Reinstate him and pay again — it isn't broken, it's a flag.
8. **Open the source** — `require(newPeriod >= oldPeriod, ...)` in `EmploymentVault.amend()`,
   and the satoshi-floor checks in `PayrollTreasury.paySalary()`. These are refusals, not
   features, and the UI can't click through them because that's the point.
9. **Say it and mean it:** *"I wrote this contract, and I cannot steal from it."* No signature
   anywhere in `paySalary`; every recipient read from data; every amount computed by statute.
   Then name where that sentence stops being true — the HR minting baton — because a pitch that
   only shows the part that works is weaker than one that shows where it stops.

---

## Reconciliation — to the centavo

| | Maria Santos (taxed) | Jun Dela Cruz (zero-tax) |
|---|---:|---:|
| SSS | ₱2,640.00 | ₱1,215.00 |
| PhilHealth | ₱875.00 | ₱400.00 |
| Pag-IBIG | ₱200.00 | ₱200.00 |
| BIR | ₱1,021.60 | *(no output)* |
| **Net pay** | **₱16,065.90** | **₱7,300.00** |
| **Total drawn from treasury** | **₱20,802.50** | **₱9,115.00** |
| **Employer cost, independently computed** | **₱20,802.50** ✓ | **₱9,115.00** ✓ |

The employer-cost figure is asserted equal to the total drawn in the tests, computed by a
completely different expression — gross pay plus every employer-side share — so the check shares
no arithmetic with the number it's checking.

---

## Roadmap

- **13th-month pay** — a distinct statutory disbursement shape (PD 851), same covenant family.
- **Salary loans** — a third fund an employee can draw against inside the same commitment.
- **Multisig HR and payroll-officer keys** — the honest fix for the minting-baton trust boundary,
  named in this repo's own contract comments, not discovered by a judge.
- **Wallet connect against a live wallet** — the Paytaca/WalletConnect v2 flow for `#/employee`
  is built (`app/src/wallet/paytaca.ts`: pair, `bch_getAddresses`, decode to `payeePkh`), but it
  has not yet been run against a real Paytaca wallet on chipnet.
- **BCMR on mainnet** — publish ePHP's and the Employment NFT category's on-chain metadata
  registry so any wallet renders this payroll legibly, not just this app.
