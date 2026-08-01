-- ═══════════════════════════════════════════════════════════════════════
-- Overtime: filed by the employee, worth nothing until someone approves it.
--
-- The rule this table exists to hold is the same one the domain enforces in
-- src/domain/attendance/overtime.ts — hours beyond the standard day earn
-- NOTHING until approved. Pending is not "probably fine" and rejected is not
-- "worth half". Encoding it here as well means the rule survives a client
-- that forgets it.
-- ═══════════════════════════════════════════════════════════════════════

do $$ begin
  create type public.overtime_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

create table if not exists public.overtime_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees(id) on delete cascade,
  work_date    date not null,

  -- Minutes, not fractional hours, for the same reason there are no floats
  -- anywhere in this project. The 480 ceiling mirrors
  -- MAX_OVERTIME_MINUTES_PER_DAY: a claim beyond another full working day is
  -- far likelier to be a typo than a shift, and a typo past payroll is
  -- expensive to unwind.
  minutes      integer not null check (minutes > 0 and minutes <= 480),
  reason       text    not null check (length(btrim(reason)) > 0),

  status       public.overtime_status not null default 'pending',
  filed_at     timestamptz not null default now(),
  decided_by   uuid references auth.users(id) on delete set null,
  decided_at   timestamptz,
  decision_note text,

  -- A decision carries who made it and when. Half-recorded decisions are how
  -- "we never approved that" and "we never saw it" become the same sentence.
  constraint overtime_decision_is_complete check (
    (status = 'pending'  and decided_by is null and decided_at is null)
    or
    (status <> 'pending' and decided_by is not null and decided_at is not null)
  ),

  -- One claim per employee per day; a second is an amendment, not a new claim.
  unique (employee_id, work_date)
);

create index if not exists overtime_requests_employee_idx on public.overtime_requests (employee_id, work_date desc);
create index if not exists overtime_requests_pending_idx  on public.overtime_requests (status) where status = 'pending';

-- A DECISION IS FINAL, mirroring `decide()` in the domain. Without this an
-- approval could be quietly reversed after the payroll that relied on it.
create or replace function public.guard_overtime_decision_is_final()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'overtime request % was already %; a decision is final', old.id, old.status
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_overtime_decision_is_final on public.overtime_requests;
create trigger guard_overtime_decision_is_final
  before update on public.overtime_requests
  for each row execute function public.guard_overtime_decision_is_final();

alter table public.overtime_requests enable row level security;

-- Employees file their own and read their own; HR and the payroll officer see
-- everything, and only HR decides.
drop policy if exists overtime_select_staff_or_self on public.overtime_requests;
create policy overtime_select_staff_or_self on public.overtime_requests for select to authenticated
  using (
    public.current_app_role() = any (array['hr'::user_role, 'payroll_officer'::user_role])
    or employee_id = public.current_employee_id()
  );

drop policy if exists overtime_insert_self_or_hr on public.overtime_requests;
create policy overtime_insert_self_or_hr on public.overtime_requests for insert to authenticated
  with check (
    (employee_id = public.current_employee_id() and status = 'pending')
    or public.current_app_role() = 'hr'::user_role
  );

drop policy if exists overtime_decide_hr_only on public.overtime_requests;
create policy overtime_decide_hr_only on public.overtime_requests for update to authenticated
  using (public.current_app_role() = 'hr'::user_role)
  with check (public.current_app_role() = 'hr'::user_role);

drop policy if exists overtime_delete_hr_only on public.overtime_requests;
create policy overtime_delete_hr_only on public.overtime_requests for delete to authenticated
  using (public.current_app_role() = 'hr'::user_role);

-- What approved overtime added to a payroll line. Nullable because every line
-- written before this column existed had no overtime concept at all, and 0
-- would claim it was computed and came out empty.
alter table public.payroll_run_lines
  add column if not exists overtime_minutes  integer,
  add column if not exists overtime_centavos bigint;

grant select, insert, update, delete on public.overtime_requests to authenticated;
