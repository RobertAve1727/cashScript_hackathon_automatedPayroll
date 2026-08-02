# Judge answers

Five questions about how eSahod actually works, answered against this codebase with file and
line references, plus the sparring answers to the objections a Philippine private-sector payroll
pitch gets asked most.

All line numbers below are from the contracts and domain files as committed at the time of
writing (`contracts/payroll_treasury.cash`, `contracts/employment_vault.cash`,
`src/domain/payroll/types.ts`, `src/domain/payroll/commitment.ts`).

## 1. Why does `payeePkh` live inside the NFT commitment instead of a contract parameter?

Because it decides who is *allowed* to trigger payroll: everyone, safely.

`src/domain/payroll/types.ts:35` puts `payeePkh` at offset 0 of the 40-byte commitment, and
`payroll_treasury.cash:173` is where the covenant reads it back out — the very first thing
`paySalary` does after checking the input shape is `bytes payeePkh, bytes c1 =
tx.inputs[1].nftCommitment.split(20)`. Every later use of that value is a *requirement*, not a
default: `payroll_treasury.cash:289` requires `tx.outputs[0].lockingBytecode == new
LockingBytecodeP2PKH(unsafe_bytes20(payeePkh))` — output 0 must pay exactly this wallet, read
from data the *transaction itself* carries in, not from anything baked into the contract at
deployment time.

If `payeePkh` were a constructor argument instead — one wallet, hardcoded, for one specific
payroll run — then handing someone the ability to broadcast payroll would also hand them the
ability to redirect it, because the contract would have no independent source of truth for who
should be paid. Because the payee travels *with the record*, a payroll officer, an employee, or
an anonymous keeper bot can run a batch of five thousand payments and remain mathematically
unable to redirect a single centavo of any of them — the contract has nothing to decide, only
something to check. That is the whole reason `paySalary` needs no signature (see question 3):
delegating the trigger costs nothing because the trigger carries no discretion.

## 2. Why does `EmploymentVault.payroll()` check input 0's locking bytecode?

Because the treasury's own guarantee — "input 1 must be a genuine Employment NFT"
(`payroll_treasury.cash:159`) — only says something about *what kind of token* is being spent
alongside it. It says nothing about what happens to that token once the transaction is built,
and nothing stops the NFT from being paired with a different contract entirely.

`EmploymentVault.payroll()` is the missing half. `employment_vault.cash:61` requires `this.
activeInputIndex == 1` — this record must be input 1 of whatever transaction is spending it —
and `employment_vault.cash:62–63` requires `tx.inputs[0].lockingBytecode == treasuryLock`, where
`treasuryLock` (`employment_vault.cash:33`) is the *full 35-byte P2SH32 locking bytecode* of one
specific, already-deployed `PayrollTreasury` — `OP_HASH256 <32-byte script hash> OP_EQUAL`. That
is an identity check against a specific contract with specific remittance addresses and a
specific period schedule, not "some contract that looks like a treasury."

Without this check, an attacker could pair the real employment NFT with a look-alike contract
that copies the treasury's output shape but pays nobody — advancing `nextPeriod` twenty-four
times over a year while the employee's wallet stays empty, all without a single invalid
transaction appearing anywhere. `payroll()` is the clause that makes that impossible, and it is
why the period counter can be trusted as a genuine payment record rather than just a number that
went up.

## 3. Where is double-payment prevented, and why can't HR undo it?

Two separate mechanisms, stacked:

**Bitcoin's own UTXO model** prevents the obvious replay. Once a `paySalary` transaction for
period *N* confirms, the coin that carried `nextPeriod = N` no longer exists — it has been spent
and cannot be spent again by anyone, for any reason. That's not something eSahod added; it's the
ledger's baseline guarantee.

The interesting attack isn't replay, it's **rewinding**: could HR, or a thief holding the HR
key, edit the record back to an earlier `nextPeriod` and let the ordinary, permissionless payroll
path pay out those periods a second time? `EmploymentVault.amend()` is the only function that can
change the record at all, and it is answered at `employment_vault.cash:134–137`:

```
int oldPeriod = int(tx.inputs[this.activeInputIndex].nftCommitment.split(34)[0].split(32)[1]);
int newPeriod = int(tx.outputs[this.activeInputIndex].nftCommitment.split(34)[0].split(32)[1]);
require(newPeriod >= oldPeriod, "nextPeriod must never move backwards");
```

That single `require` is the guarantee that survives a compromised HR key. HR can still suspend
an employee, separate them, set `endPeriod` to a past value to stop future payments, correct a
salary, or move the record to next year's vault — every one of those is a lawful employer
prerogative and every one is visible on chain. What no signature, no key, and no code path in
this contract can do is make an *already-paid* period payable again. A rewind of 24 periods
would be a second year's salary drained with no invalid transaction anywhere in sight, which is
exactly the failure mode this one line closes.

## 4. Why are the four remittance hashes passed as function arguments instead of stored directly?

`paySalary(bytes20 sssPkh, bytes20 phicPkh, bytes20 hdmfPkh, bytes20 birPkh)`
(`payroll_treasury.cash:129–134`) takes the four remittance recipients as arguments, and checks
them against one stored value: `payroll_treasury.cash:162–163` requires `hash160(sssPkh + phicPkh
+ hdmfPkh + birPkh) == remitConfigHash`, where `remitConfigHash` (`payroll_treasury.cash:93`) is
the only remittance-related value the contract actually stores.

This buys two things at once. First, it keeps the four real addresses *public and independently
verifiable* rather than opaque: the company publishes `sssPkh`, `phicPkh`, `hdmfPkh`, `birPkh`
alongside `remitConfigHash`, anyone can hash them and confirm the match themselves before
trusting a payroll run, and the permissionless broadcaster — who might be a bot with no
relationship to the company at all — has to supply exactly those four values or the transaction
is rejected. Second, and more important: **a CashScript contract's address is derived from its
constructor arguments.** If a remittance address ever needs to change — SSS updates its
collection account, say — `remitConfigHash` changes, which means the treasury's *address*
changes, which means it is a different contract that has to be funded and migrated to
deliberately. There is no code path in which a remittance address changes quietly underneath an
already-funded treasury. That is exactly the blast radius a change of that severity should have.

## 5. Why does `tax > 0` change which output holds the NFT and the change?

Because of one Bitcoin Cash consensus rule that has nothing to do with payroll: a CashToken
output carrying zero fungible units is invalid. It cannot exist on chain, full stop.

`payroll_treasury.cash:317–327` computes `nftOut`/`changeOut` before touching either output:

```
int nftOut    = 5;
int changeOut = 6;
if (tax > 0) {
    require(tx.outputs[4].lockingBytecode == new LockingBytecodeP2PKH(birPkh), ...);
    ...
} else {
    nftOut    = 4;
    changeOut = 5;
}
```

When an employee owes withholding tax, output 4 pays the BIR and the record/change sit at 5 and
6. When they don't, output 4 *cannot* be "the BIR, paying zero" — it has to not exist — so the
record and change slide up to 4 and 5, and there are six outputs total instead of seven.
`outputLayoutFor(taxPerPeriod)` in `src/domain/payroll/types.ts:97–109` is the single function
that resolves this for every other layer (the frontend, the tests, a future chipnet script), so
nobody hardcodes `4` where they meant "wherever the NFT currently is."

This is not a rare corner case dressed up as a big design decision. Minimum-wage earners are
exempt from income tax outright under RA 9504, so in a real Philippine private payroll the
zero-tax shape is the *common* one. A covenant that only worked cleanly for the taxed case would
be unusable for exactly the workers it most needs to protect — which is why both fixture
employees in this repo were chosen specifically to exercise both branches.

---

## Sparring answers

**"This is just a database with extra steps."** A database entry is something one administrator
edits unilaterally, with a trace only if someone bothered to log it. `paySalary` needs *no
signature at all* — the payroll officer, the employee being paid, or a stranger's keeper bot can
broadcast it, and the result is byte-for-byte identical regardless of who does, because every
recipient and every amount is derived from the employment record and the statutes, never chosen
by whoever hits the button (question 1). Money provably moved the moment the transaction
confirms, on a ledger nobody involved controls. A payroll database can be told anything;
`paySalary` can only be told the truth, because "the truth" is the only transaction shape it
accepts.

**"ePHP isn't a real peso."** Correct, and eSahod doesn't claim otherwise. ePHP is a
company-issued bookkeeping token — 1 unit = 1 centavo of the funding that company deposited into
its treasury — not a central-bank-issued currency and not a general-purpose stablecoin. Its only
economic promise is "this company put in real money and the covenant will pay it out exactly per
the statutes below." Whether the company *had* that real money to begin with, and whether ePHP
can be redeemed for pesos on the way out, is a banking and compliance question outside this
repository's scope — the same trust boundary as the minting baton described below, stated
honestly rather than hidden behind the word "token."

**"Nobody in payroll is going to adopt Bitcoin Cash."** The target isn't payroll teams falling in
love with a blockchain; it's a country with one of the world's largest overseas-remittance
economies, where crypto-literate wallets (Paytaca chief among them) already have real Filipino
user bases built specifically around BCH remittances. The unbanked-and-underbanked worker who
already receives money from a relative abroad through a BCH wallet is not being asked to learn a
new technology to receive payroll through the same one. The harder problem — a production
peso-in, ePHP-out ramp through an actual banking or exchange partner — is explicitly out of scope
for this repository and named as a roadmap item, not glossed over as solved.

**"What if an employee loses their phone?"** `payeePkh` is an ordinary P2PKH hash; recovery is
whatever the employee's wallet offers for any other BCH funds — typically a seed phrase, the same
UX as losing any other crypto wallet. If the wallet and its backup are both genuinely gone, HR's
`amend()` path can update `payeePkh` to a new wallet the same way it can correct a salary or
extend a contract (`employment_vault.cash:82–110`) — a signed, on-chain, visible action, which is
a materially *better* audit trail than the phone call an HR department gets today when someone
asks to change their registered payroll bank account.

**"What if the HR key is compromised?" — the honest answer.** The minting baton is the root of
trust, and this repository says so in its own comments rather than waiting for a judge to find
it: `payroll_treasury.cash:37–64` states plainly that whoever holds the Employment NFT category's
minting key can mint a record naming *any* `payeePkh`, and have it paid through a perfectly
lawful-looking payroll run, because the treasury only verifies that a record belongs to the
trusted category — not who minted it or why. That is not a bug found late; it is the structural
consequence of exactly that: a covenant comparing a category can distinguish a *category*, never a
*record*. Pinning the vault's address in the treasury would not close it either — the second
`CONTRAST` case in `tests/infrastructure/esahod/genesis.test.ts` drains 60% of a treasury with a
forged record minted straight *into* the vault — which is why the guarantee has to come from
destroying the minting authority at genesis rather than from another `require`. The `amend()`
path has the same single-key exposure today (`hrPkh`, one signature). Production hardening is
explicit and stated, not hand-waved: the minting NFT and the HR key both belong behind a
multisig, ideally behind a covenant-guarded minting path so no single stolen key — HR's or
anyone else's — can create or amend an employment record alone. Forged records are *possible* for
whoever holds the baton; they are *not possible* for anyone who doesn't, which is the actual
security property this design sells, and the only one it sells.

**"BCH is too volatile for a payroll system."** ePHP is not priced in BCH and never touches BCH's
market price — it's a fixed-denomination company-issued token, 1 unit fixed at 1 centavo of the
funding deposited, that happens to ride BCH rails because BCH settlement is fast, cheap and
supports the CashTokens/covenant machinery this design depends on. The only BCH exposure anywhere
in the design is the small satoshi "dust" every token output must carry (≥546 sats, 1,000 sats
used throughout this repo) plus the mining fee — both funded from a separate fee input, never
from the payroll funding itself (`payroll_treasury.cash:357`, `:388`). A worker's ₱16,065.90 net
pay is ₱16,065.90 regardless of what BCH is doing in the market that day.

**Evidence the team red-teams its own covenant.** The satoshi-floor requirements now at
`payroll_treasury.cash:358–359` and `:389–390` were not part of the contract's first working
version — they were added after review identified a real drain: without them, the anonymous
broadcaster this design deliberately invites could return the employment NFT and the treasury
change on the 546–1,000 sat dust minimum while pocketing the *actual* BCH balance riding under
those coins in their own output, turning a lawful payroll run into a slow theft of the contract's
carrying value. Fixing it grew the contract from 518 to 533 bytes and past the historic 520-byte
push limit — a real, documented tradeoff (the header comment at `payroll_treasury.cash:83–88`
says so outright), accepted because keeping the treasury's BCH un-strippable was judged worth
more than staying under a limit the network no longer enforces post the May 2025 VM-limits
upgrade. A team that finds and fixes its own fund-draining bug, and leaves the reasoning in the
source rather than in a private changelog, is doing the thing a security review is supposed to
force — here it happened before anyone external asked.
