-- ═══════════════════════════════════════════════════════════════════════
-- Close the privilege-escalation path, and tighten the RLS around it.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. THE ESCALATION.
--
-- current_app_role() reads profiles.role, and profiles' UPDATE policy had a
-- USING of (id = auth.uid()) with no WITH CHECK. So a signed-in employee
-- could set their own role to 'hr' and gain write access to every table.
--
-- WITH CHECK cannot express this on its own: it sees only the NEW row, so it
-- cannot say "role must not have changed". A BEFORE UPDATE trigger can,
-- because it sees OLD and NEW. It reads the role from the pre-update row,
-- which is exactly the check that must not be self-referential.
create or replace function public.guard_profile_privilege_columns()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Server-side callers (service_role, migrations, the SQL editor) carry no
  -- auth.uid(); the Data API always does. Seeding must stay possible.
  if auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.employee_id is distinct from old.employee_id then
    if public.current_app_role() is distinct from 'hr'::user_role then
      raise exception 'only HR may change a profile''s role or employee link'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privilege_columns on public.profiles;
create trigger guard_profile_privilege_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privilege_columns();

-- 2. EVERY UPDATE POLICY GAINS A WITH CHECK.
--
-- Without one, a row that passes USING can be rewritten into a row that would
-- not — including moving it to another owner. Each CHECK mirrors its USING.
drop policy if exists profiles_update_own_or_hr on public.profiles;
create policy profiles_update_own_or_hr on public.profiles for update to authenticated
  using  ((id = (select auth.uid())) or (public.current_app_role() = 'hr'::user_role))
  with check ((id = (select auth.uid())) or (public.current_app_role() = 'hr'::user_role));

drop policy if exists attendance_update_hr_only on public.attendance_records;
create policy attendance_update_hr_only on public.attendance_records for update to authenticated
  using (public.current_app_role() = 'hr'::user_role)
  with check (public.current_app_role() = 'hr'::user_role);

drop policy if exists employees_update_hr_only on public.employees;
create policy employees_update_hr_only on public.employees for update to authenticated
  using (public.current_app_role() = 'hr'::user_role)
  with check (public.current_app_role() = 'hr'::user_role);

drop policy if exists run_lines_update_payroll_officer on public.payroll_run_lines;
create policy run_lines_update_payroll_officer on public.payroll_run_lines for update to authenticated
  using (public.current_app_role() = 'payroll_officer'::user_role)
  with check (public.current_app_role() = 'payroll_officer'::user_role);

drop policy if exists payroll_runs_update_payroll_officer on public.payroll_runs;
create policy payroll_runs_update_payroll_officer on public.payroll_runs for update to authenticated
  using (public.current_app_role() = 'payroll_officer'::user_role)
  with check (public.current_app_role() = 'payroll_officer'::user_role);

drop policy if exists signer_keys_update_payroll_officer on public.signer_keys;
create policy signer_keys_update_payroll_officer on public.signer_keys for update to authenticated
  using (public.current_app_role() = 'payroll_officer'::user_role)
  with check (public.current_app_role() = 'payroll_officer'::user_role);

drop policy if exists statutory_rates_update_payroll_officer on public.statutory_rate_tables;
create policy statutory_rates_update_payroll_officer on public.statutory_rate_tables for update to authenticated
  using (public.current_app_role() = 'payroll_officer'::user_role)
  with check (public.current_app_role() = 'payroll_officer'::user_role);

-- 3. auth.role() IS DEPRECATED, AND BREAKS WITH ANONYMOUS SIGN-INS.
--
-- An anonymous user carries the `authenticated` Postgres role, so
-- `auth.role() = 'authenticated'` passes for someone who never signed in.
-- The TO clause is the supported way to say the same thing, correctly.
drop policy if exists statutory_rates_select_authenticated on public.statutory_rate_tables;
create policy statutory_rates_select_authenticated on public.statutory_rate_tables for select
  to authenticated using (true);

-- 4. SECURITY DEFINER HELPERS: pin search_path, and keep them off anon.
--
-- A SECURITY DEFINER function with a mutable search_path can be redirected to
-- attacker-controlled objects. EXECUTE is granted to PUBLIC by default, which
-- makes every one of these callable without signing in.
alter function public.current_app_role()    set search_path = public, pg_temp;
alter function public.current_employee_id() set search_path = public, pg_temp;
alter function public.current_role()        set search_path = public, pg_temp;
alter function public.handle_new_user()     set search_path = public, pg_temp;
alter function public.set_updated_at()      set search_path = public, pg_temp;

revoke execute on function public.current_app_role()    from anon, public;
revoke execute on function public.current_employee_id() from anon, public;
revoke execute on function public.current_role()        from anon, public;
grant  execute on function public.current_app_role()    to authenticated;
grant  execute on function public.current_employee_id() to authenticated;
grant  execute on function public.current_role()        to authenticated;
