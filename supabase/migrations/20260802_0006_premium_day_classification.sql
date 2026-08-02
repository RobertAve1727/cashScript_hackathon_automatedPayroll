-- What kind of day an overtime request falls on, and how much of it was night.
--
-- Overtime pay is not one multiplier. Art. 87 gives +25% on an ordinary day and
-- +30% on a rest day or holiday — of the rate ALREADY established for that day
-- — and Art. 86 adds 10% for each hour between 10 p.m. and 6 a.m., on top of
-- whatever that hour was already worth. So an overtime night hour on a regular
-- holiday is 200% x 130% x 110% = 286% of the ordinary rate, not 155%.
--
-- The engine (src/domain/attendance/premiums.ts) computes all of it. What it
-- cannot know is which days were holidays or rest days: that comes from a DOLE
-- proclamation and the employee's own schedule, neither of which is derivable
-- from a punch log. So it is stored, and it is HR's recorded decision.
--
-- `night_minutes` is derived rather than declared — the punch log already knows
-- when someone was working, so nightMinutesIn() counts the minutes inside the
-- window. An entitlement nobody has to remember to claim is one nobody can
-- forget to pay.

begin;

create type public.day_classification as enum (
  'ordinary',
  'rest_day',
  'special_non_working',
  'special_non_working_rest_day',
  'regular_holiday',
  'regular_holiday_rest_day',
  -- Looks like a holiday, pays like an ordinary day. Named so the trap is
  -- visible rather than absent.
  'special_working'
);

alter table public.overtime_requests
  add column day_classification public.day_classification not null default 'ordinary',
  add column night_minutes integer not null default 0;

alter table public.overtime_requests
  add constraint overtime_night_within_request
  check (night_minutes >= 0 and night_minutes <= minutes);

comment on column public.overtime_requests.day_classification is
  'Art. 91-94 day type. Set by HR — a proclamation is not derivable from attendance.';
comment on column public.overtime_requests.night_minutes is
  'Art. 86 minutes between 22:00 and 06:00, derived from the punch log by nightMinutesIn().';

commit;
