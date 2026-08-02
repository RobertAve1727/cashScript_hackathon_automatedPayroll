-- ═══════════════════════════════════════════════════════════════════════
-- Names in parts, because one string cannot be taken apart again.
--
-- "Jun Dela Cruz" has a two-word surname and "Maria Cruz Santos" has a middle
-- name, and no split-on-space distinguishes them. Every statutory form
-- (SSS R-1A, PhilHealth ER2, BIR 2316) asks for the parts separately, so they
-- are stored separately and joined for display rather than the reverse.
--
-- full_name stays as a GENERATED column: existing readers keep working and it
-- can never drift from the parts, because the database computes it.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.employees add column if not exists first_name  text;
alter table public.employees add column if not exists middle_name text;
alter table public.employees add column if not exists last_name   text;

alter table public.profiles  add column if not exists first_name  text;
alter table public.profiles  add column if not exists middle_name text;
alter table public.profiles  add column if not exists last_name   text;

-- Backfill from what is already there. Split on the LAST space, so a
-- multi-word surname stays whole — the common failure of naive splitting.
update public.employees set
  first_name = coalesce(first_name, split_part(full_name, ' ', 1)),
  last_name  = coalesce(last_name,
                 nullif(btrim(substr(full_name, length(split_part(full_name,' ',1)) + 2)), ''))
where first_name is null or last_name is null;

update public.profiles p set
  first_name = coalesce(p.first_name, split_part(p.full_name, ' ', 1)),
  last_name  = coalesce(p.last_name,
                 nullif(btrim(substr(p.full_name, length(split_part(p.full_name,' ',1)) + 2)), ''))
where p.full_name is not null and (p.first_name is null or p.last_name is null);

-- The fixtures, corrected by hand where the split cannot know better.
update public.employees set first_name='Maria', middle_name='Cruz', last_name='Santos' where employee_no='1001';
update public.employees set first_name='Jun',   middle_name=null,   last_name='Dela Cruz' where employee_no='1002';

update public.profiles p set first_name='Maria', middle_name='Cruz', last_name='Santos'
  where p.id = (select id from auth.users where email='maria.santos@esahod.ph');
update public.profiles p set first_name='Jun', middle_name=null, last_name='Dela Cruz'
  where p.id = (select id from auth.users where email='jun.delacruz@esahod.ph');
update public.profiles p set first_name='Rosa', middle_name='Bautista', last_name='Villanueva'
  where p.id = (select id from auth.users where email='rosa.villanueva@esahod.ph');
update public.profiles p set first_name='Ben', middle_name=null, last_name='Aquino'
  where p.id = (select id from auth.users where email='ben.aquino@esahod.ph');

-- A blank name is not a name. The UI refuses it too, but a constraint is what
-- makes that true of every client rather than of one form.
alter table public.employees
  alter column first_name set not null,
  alter column last_name  set not null;

alter table public.employees drop constraint if exists employees_name_not_blank;
alter table public.employees add constraint employees_name_not_blank
  check (length(btrim(first_name)) > 0 and length(btrim(last_name)) > 0);

-- full_name becomes derived, so it cannot disagree with the parts.
alter table public.employees drop column if exists full_name;
alter table public.employees add column full_name text
  generated always as (
    btrim(first_name || ' ' || coalesce(middle_name || ' ', '') || last_name)
  ) stored;

alter table public.profiles drop column if exists full_name;
alter table public.profiles add column full_name text
  generated always as (
    btrim(coalesce(first_name,'') || ' ' || coalesce(middle_name || ' ', '') || coalesce(last_name,''))
  ) stored;
