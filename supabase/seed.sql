-- ═══════════════════════════════════════════════════════════════════════
-- Seed, matched to the LIVE chipnet deployment.
--
-- What this table holds about money is a MIRROR, not the source of truth.
-- monthly_basic, next_period and the vault pointers all live in the 40-byte
-- NFT commitment on chain; these columns exist so a list can be rendered and
-- joined without a chain round-trip per row. Where the two disagree, the
-- chain is right and this is stale — which is why last_synced_at exists on
-- treasury_state and why the app reads balances from the chain adapter.
--
-- What is NOT on chain, and genuinely lives here: names, emails, departments,
-- hire dates, attendance and overtime. The commitment has no room for them.
-- ═══════════════════════════════════════════════════════════════════════

insert into public.employees
  (employee_no, full_name, department, payee_pkh,
   monthly_basic, monthly_allowance, tax_per_period,
   next_period, end_period, status,
   vault_address, nft_commitment_category, contact_email)
values
  ('1001','Maria Santos','Engineering','8839f70bf8a744f17009f28c31550fc3875db592',
   3500000, 200000, 102160, 1, 23, 'active',
   'bchtest:pwhm3arc557kzt79kp97gnmt370r3e2yv2kqxjck8ygrrz4zhv0q5lfhw4hs8',
   'afb8ae9d4c3b2ad2ba4e85b443469be4171291fa8b2406494a72e7fbba04b4e1',
   'maria.santos@esahod.ph'),
  ('1002','Jun Dela Cruz','Warehouse','9e31987a8ce658cd11110b3f4477c27742ff69b5',
   1600000, 0, 0, 0, 23, 'active',
   'bchtest:pwhm3arc557kzt79kp97gnmt370r3e2yv2kqxjck8ygrrz4zhv0q5lfhw4hs8',
   'afb8ae9d4c3b2ad2ba4e85b443469be4171291fa8b2406494a72e7fbba04b4e1',
   'jun.delacruz@esahod.ph')
on conflict (employee_no) do update set
  full_name = excluded.full_name,
  payee_pkh = excluded.payee_pkh,
  monthly_basic = excluded.monthly_basic,
  monthly_allowance = excluded.monthly_allowance,
  tax_per_period = excluded.tax_per_period,
  next_period = excluded.next_period,
  end_period = excluded.end_period,
  vault_address = excluded.vault_address,
  nft_commitment_category = excluded.nft_commitment_category;

-- Roles, and the employee link for the two who have one.
update public.profiles p set
  role = v.role::user_role,
  full_name = v.full_name,
  employee_id = (select e.id from public.employees e where e.employee_no = v.employee_no)
from (values
  ('maria.santos@esahod.ph','employee','Maria Santos','1001'),
  ('jun.delacruz@esahod.ph','employee','Jun Dela Cruz','1002'),
  ('rosa.villanueva@esahod.ph','hr','Rosa Villanueva',null),
  ('ben.aquino@esahod.ph','payroll_officer','Ben Aquino',null)
) as v(email, role, full_name, employee_no)
where p.id = (select u.id from auth.users u where u.email = v.email);

-- The remittance destinations the covenant is pinned to, and the three keys.
insert into public.signer_keys (role_label, pkh, label) values
  ('sss','46cd06f7374e2360eaa86a18726d539f4b37c62f','SSS remittance address'),
  ('philhealth','d436251d2715f3e1651b7ead159d167349f199ae','PhilHealth remittance address'),
  ('pagibig','0bc39b59a0046e512ec920fa20378843357ff6fa','Pag-IBIG remittance address'),
  ('bir','25ba148025aa5c64f0148488d406212b88a5925c','BIR remittance address'),
  ('keeper','ba8e2f33d36f4db5adb3d1ccce4a4817fce6085e','Fee payer — hot, pays every tx fee'),
  ('hr','4b28d3abb5e378ac57e1f1dab34202fc7d457e82','HR — signs amend()'),
  ('payroll_officer','20c494fb2839c9fbfb422667283cc982cff2870d','Officer — signs sweepLapsedNca only')
on conflict do nothing;

-- Treasury mirror. Balance as of the one payroll run already broadcast.
insert into public.treasury_state (category_id, ephp_balance_centavos, last_synced_at)
values ('ab7c3787bf6b678829c14b8b4d20117548d5fcf819e5733b4eef0b85d2925d6d', 497919750, now())
on conflict do nothing;

-- The transactions that actually happened on chipnet, so the audit trail in
-- the database points at something a block explorer can confirm.
insert into public.chain_transactions (tx_type, txid, status, raw_details) values
  ('genesis','df61948ef60e43cd3b7944c4d11ce2c80ca7c5e14016b112ab18f94b08046e8b','broadcast',
   '{"what":"ePHP category genesis","category":"ab7c3787bf6b678829c14b8b4d20117548d5fcf819e5733b4eef0b85d2925d6d"}'),
  ('genesis','1dcd1b10fb1d76f35d35405a033b8b13af7729297042b99dc8e4a7cd9bf38662','broadcast',
   '{"what":"employment category genesis","category":"afb8ae9d4c3b2ad2ba4e85b443469be4171291fa8b2406494a72e7fbba04b4e1"}'),
  ('genesis','fd0ef8e57f442f690b63166b537c13f79f59058cf0dcbc49f1ac70c8287f30ab','broadcast',
   '{"what":"enrol 2 employees and burn the minting baton","employees":["1001","1002"]}'),
  ('payroll','fa4e036c01b3296185abe39bdfd05a00621670b2e7cfef7a8cfa31c23855a916','broadcast',
   '{"employee":"1001","period":0,"net":1606590,"sss":264000,"philhealth":87500,"pagibig":20000,"bir":102160,"drawn":2080250}')
on conflict do nothing;
