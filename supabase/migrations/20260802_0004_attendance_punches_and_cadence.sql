-- Attendance as append-only punches, and pay cadence as a per-employee setting.
--
-- ══ WHY A PUNCHES TABLE AND NOT JUST attendance_records ═════════════════
--
-- `attendance_records` is one row per employee per day, with `time_in` and
-- `time_out`. That shape has a problem this project cannot afford: closing a
-- day is an UPDATE, so an employee clocking out has to be granted UPDATE on
-- their own attendance row — and UPDATE is also how you rewrite an arrival
-- time. The existing policy took the other horn and granted UPDATE to HR only,
-- which means an employee could clock in and then never clock out.
--
-- The chain does not have this problem, because the chain has no days. It has
-- punches: one OP_RETURN per tap, each a claim about a moment that has already
-- passed. A day is a fold over punches, not a thing anyone writes.
--
-- So the database is reshaped to match. `attendance_punches` is append-only —
-- employees INSERT their own and nobody UPDATEs the parts that matter — and
-- `attendance_records` becomes a projection maintained by a trigger. Its
-- client write policies are dropped, so no client can assert a day that
-- disagrees with the punches behind it.
--
-- The immutability is enforced by TRIGGER, not only by policy, and that is
-- deliberate: the service_role key bypasses row-level security. It does not
-- bypass triggers. A punch cannot be rewritten by anyone holding any key in
-- this project — the correction path is a new punch, which is visible.
--
-- ══ WHY CADENCE IS AN ENUM WITH ONE VALUE PERMANENTLY REFUSED ═══════════
--
-- `src/domain/payroll/schedule.ts` models four cadences and offers three.
-- Monthly is modelled because it exists in the world and the engine must be
-- able to talk about it; it is not offered because Article 103 of the Labor
-- Code requires wages "at least once every two weeks or twice a month at
-- intervals not exceeding sixteen days", and a monthly interval is 28–31 days.
--
-- Keeping the value in the enum and refusing it in a CHECK is the honest
-- encoding: the constraint name carries the reason, so an operator who tries
-- gets the law rather than a shrug from a greyed-out button.

begin;

-- ────────────────────────────────────────────────────────────────────────
-- 0. Guards for what this file depends on
-- ────────────────────────────────────────────────────────────────────────
--
-- The baseline schema of this project — employees, attendance_records, the
-- tx_status enum — was created against the live database before migrations
-- were kept in the repo, so migrations 0001..0003 are deltas on a starting
-- point no file here describes. Everything below needs two pieces of that
-- baseline, so they are asserted rather than assumed: this file then runs on
-- the project it was written against AND on a database where those two
-- happen to be missing.
--
-- This does not make the repo reproduce the database on its own; see
-- supabase/README.md. It makes this migration stop being the place that
-- discovers the problem.

do $$ begin
  create type public.tx_status as enum ('pending', 'broadcast', 'confirmed', 'failed');
exception when duplicate_object then null;
end $$;

-- refresh_attendance_day below upserts with `on conflict (employee_id, work_date)`,
-- which needs this constraint to exist by name.
do $$ begin
  alter table public.attendance_records
    add constraint attendance_records_employee_id_work_date_key
    unique (employee_id, work_date);
exception when duplicate_table or duplicate_object then null;
end $$;

-- ────────────────────────────────────────────────────────────────────────
-- 1. Punches
-- ────────────────────────────────────────────────────────────────────────

create type public.punch_kind as enum ('in', 'out');

create table public.attendance_punches (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees (id) on delete cascade,
  work_date date not null,
  kind public.punch_kind not null,
  punched_at timestamptz not null,

  -- The 13 bytes the chain carries for this punch, exactly as `encodePunch`
  -- in src/domain/attendance/time-record.ts builds them: magic 'eSHD',
  -- version, kind, employee number (3B LE), unsigned 4B timestamp. 13 bytes
  -- is 26 hex characters, and the constraint says so — a payload of any other
  -- length is not a punch this system can anchor, and the database should not
  -- be the place that finds out later.
  payload_hex text not null check (payload_hex ~ '^[0-9a-f]{26}$'),

  anchor_tx_id text,
  anchor_status public.tx_status not null default 'pending',
  recorded_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);

create index attendance_punches_employee_day_idx
  on public.attendance_punches (employee_id, work_date, punched_at);

comment on table public.attendance_punches is
  'Append-only. One row per OP_RETURN anchor. A punch is never edited; a correction is a new punch.';

-- An 'out' with no 'in' is not a short day, it is an impossible one. The
-- in-memory gateway already refuses it (attendance-gateway.ts); this is the
-- same rule where a client cannot route around it.
create or replace function public.attendance_punch_is_well_formed()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.kind = 'out' and not exists (
    select 1 from public.attendance_punches
    where employee_id = new.employee_id
      and work_date = new.work_date
      and kind = 'in'
  ) then
    raise exception 'cannot clock out on %: there is no clock-in for that day', new.work_date
      using errcode = '23514';
  end if;

  -- The punch names a day; the timestamp must fall in it. Otherwise a punch
  -- could be filed against a day it did not happen on, which is precisely the
  -- edit the append-only rule exists to prevent.
  if (new.punched_at at time zone 'Asia/Manila')::date <> new.work_date then
    raise exception 'punch timestamp % is not on work_date %', new.punched_at, new.work_date
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger attendance_punch_well_formed
  before insert on public.attendance_punches
  for each row execute function public.attendance_punch_is_well_formed();

-- Append-only, enforced below RLS so that no key in this project can edit a
-- punch. The one permitted mutation is filling in an anchor txid that was not
-- known when the punch was recorded — once, never a second time.
create or replace function public.attendance_punch_is_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a punch records a moment that has passed and cannot be deleted; file a correcting punch'
      using errcode = '42501';
  end if;

  if new.id is distinct from old.id
     or new.employee_id is distinct from old.employee_id
     or new.work_date is distinct from old.work_date
     or new.kind is distinct from old.kind
     or new.punched_at is distinct from old.punched_at
     or new.payload_hex is distinct from old.payload_hex then
    raise exception 'a punch cannot be edited; file a correcting punch instead'
      using errcode = '42501';
  end if;

  if old.anchor_tx_id is not null and new.anchor_tx_id is distinct from old.anchor_tx_id then
    raise exception 'the anchor transaction of a punch may be filled in once, never changed'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger attendance_punch_immutable
  before update or delete on public.attendance_punches
  for each row execute function public.attendance_punch_is_immutable();

-- ────────────────────────────────────────────────────────────────────────
-- 2. The day, as a projection of its punches
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.refresh_attendance_day()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_employee uuid := new.employee_id;
  target_date date := new.work_date;
begin
  insert into public.attendance_records (
    employee_id, work_date, time_in, time_out, anchor_tx_id, anchor_status
  )
  select
    target_employee,
    target_date,
    -- Earliest arrival, not the latest: tapping in twice on a day already
    -- open must never quietly reset the clock forward.
    min(p.punched_at) filter (where p.kind = 'in'),
    -- Latest departure. A second tap out extends the day rather than
    -- truncating it, which is the reading that cannot cost someone hours.
    max(p.punched_at) filter (where p.kind = 'out'),
    (array_agg(p.anchor_tx_id order by p.punched_at)
       filter (where p.kind = 'in' and p.anchor_tx_id is not null))[1],
    -- A day is only as settled as its least-settled punch. Reporting a day
    -- confirmed while one of its anchors is still pending would overstate
    -- what the chain has actually accepted.
    case
      when bool_or(p.anchor_status = 'failed') then 'failed'
      when bool_and(p.anchor_status = 'confirmed') then 'confirmed'
      when bool_or(p.anchor_status = 'broadcast') then 'broadcast'
      else 'pending'
    end::public.tx_status
  from public.attendance_punches p
  where p.employee_id = target_employee
    and p.work_date = target_date
  on conflict (employee_id, work_date) do update
    set time_in = excluded.time_in,
        time_out = excluded.time_out,
        anchor_tx_id = excluded.anchor_tx_id,
        anchor_status = excluded.anchor_status;

  return null;
end;
$$;

create trigger attendance_day_projection
  after insert or update on public.attendance_punches
  for each row execute function public.refresh_attendance_day();

-- The day is derived now, so nothing may write it directly. Dropping these is
-- the point of the migration: with them in place a client could assert a day
-- that its own punches contradict, and the punches would be the thing that
-- looked wrong.
drop policy if exists attendance_insert_self_or_hr on public.attendance_records;
drop policy if exists attendance_update_hr_only on public.attendance_records;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Row-level security on punches
-- ────────────────────────────────────────────────────────────────────────

alter table public.attendance_punches enable row level security;

grant select, insert, update on public.attendance_punches to anon, authenticated;

create policy attendance_punches_select_staff_or_self
  on public.attendance_punches for select
  to authenticated
  using (
    public.current_app_role() = any (array['hr'::public.user_role, 'payroll_officer'::public.user_role])
    or employee_id = public.current_employee_id()
  );

-- An employee files their own punches. HR may file on someone's behalf — a
-- forgotten tap is a real thing — and because the table is append-only, doing
-- so leaves a row saying who recorded it rather than silently changing a time.
create policy attendance_punches_insert_self_or_hr
  on public.attendance_punches for insert
  to authenticated
  with check (
    employee_id = public.current_employee_id()
    or public.current_app_role() = 'hr'::public.user_role
  );

-- UPDATE exists only so the broadcaster can attach a txid. The immutability
-- trigger above already limits what an UPDATE is allowed to touch; this limits
-- who may attempt one at all.
create policy attendance_punches_update_anchor_only
  on public.attendance_punches for update
  to authenticated
  using (
    public.current_app_role() = any (array['hr'::public.user_role, 'payroll_officer'::public.user_role])
  )
  with check (
    public.current_app_role() = any (array['hr'::public.user_role, 'payroll_officer'::public.user_role])
  );

-- No DELETE policy, and the trigger refuses deletes regardless.

-- ────────────────────────────────────────────────────────────────────────
-- 4. Pay cadence, per employee
-- ────────────────────────────────────────────────────────────────────────

create type public.pay_cadence as enum ('daily', 'weekly', 'semi_monthly', 'monthly');

alter table public.employees
  add column pay_cadence public.pay_cadence not null default 'semi_monthly';

-- Article 103, Labor Code of the Philippines: wages shall be paid at least
-- once every two weeks or twice a month at intervals not exceeding sixteen
-- days. A monthly cadence exceeds that interval in every month of the year.
alter table public.employees
  add constraint employees_pay_cadence_lawful_art103
  check (pay_cadence <> 'monthly');

comment on column public.employees.pay_cadence is
  'How often this employee is paid. Monthly is refused by employees_pay_cadence_lawful_art103 (Art. 103, Labor Code).';

-- Only HR may change it — already covered by employees_update_hr_only, which
-- gates every column of this table on the HR role.

commit;
