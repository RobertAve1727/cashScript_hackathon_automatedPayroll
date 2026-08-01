# Supabase — the HRIS half

Project `yrbyjhwdjzvgpzcjtbeu`. These files are the SQL that was applied, kept
so the schema is reproducible rather than existing only in a dashboard.

## What belongs here, and what does not

The database holds what the 40-byte NFT commitment has no room for: names,
emails, departments, hire dates, attendance punches, overtime requests and who
approved them. Those are HRIS records and always belonged in a database.

It does **not** hold the truth about money. Salaries, pay-period counters and
balances live in the commitment and the treasury UTXO, and the chipnet adapter
reads them from there. `employees` mirrors a few of those columns so a roster
renders without a chain round-trip per row — where the two disagree, **the
chain is right and the row is stale**.

That line is the architecture. A payroll you can edit in a database is the
thing this project exists to replace.

## Files

| File | What it does |
|---|---|
| `migrations/20260802_0001_harden_rls.sql` | Closes a privilege-escalation path and tightens RLS |
| `migrations/20260802_0002_overtime_requests.sql` | Overtime, gated on approval |
| `seed.sql` | Demo accounts and employees, matched to the live chipnet deployment |

## The escalation that was fixed

`current_app_role()` reads `profiles.role`. `profiles` had an UPDATE policy
with `USING (id = auth.uid())` and **no `WITH CHECK`**, so any signed-in
employee could run:

```sql
update profiles set role = 'hr' where id = auth.uid();
```

and gain HR rights on every table. Verified as exploitable before the fix and
blocked after.

`WITH CHECK` alone cannot express the rule — it sees only the NEW row, so it
cannot say "role must not have changed". A `BEFORE UPDATE` trigger can, because
it sees OLD and NEW, and it reads the caller's role from the pre-update row.

Every other UPDATE policy also gained a `WITH CHECK` mirroring its `USING`;
without one, a row that passes `USING` can be rewritten into a row that would
not, including moving it to another owner.

## Keys

Only the **anon** key goes in the app. It is designed to ship in a browser and
grants nothing on its own, because every table has RLS and the policies key off
the signed-in user. The **service_role** key bypasses RLS entirely — it belongs
in `scripts/`, never in a bundle.
