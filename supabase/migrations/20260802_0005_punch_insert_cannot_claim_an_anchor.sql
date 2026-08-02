-- An employee may record a punch. They may not claim it is already on chain.
--
-- `attendance_punches_insert_self_or_hr` constrained `employee_id` and nothing
-- else, while the table-wide INSERT grant let a client supply every other
-- column in the same row. So an employee could file a punch with
-- `anchor_status = 'confirmed'` and an `anchor_tx_id` of their choosing — and
-- because the row is then append-only, nobody could correct it.
--
-- That inverts the property this table exists for. The anchor fields are the
-- system's own claim that a punch reached the chain; a client asserting them is
-- forging evidence, and the immutability rules would then protect the forgery.
--
-- `recorded_by` matters for the same reason: it is the audit trail of who filed
-- the punch, and a client that can set it can file one as somebody else.

begin;

drop policy if exists attendance_punches_insert_self_or_hr on public.attendance_punches;

create policy attendance_punches_insert_self_or_hr
  on public.attendance_punches for insert
  to authenticated
  with check (
    (
      employee_id = public.current_employee_id()
      or public.current_app_role() = 'hr'::public.user_role
    )
    -- A new punch is unanchored, pending, and attributed to whoever filed it.
    -- The broadcaster fills the anchor in later through the UPDATE policy,
    -- which the immutability trigger already limits to exactly that.
    and anchor_tx_id is null
    and anchor_status = 'pending'::public.tx_status
    and recorded_by = auth.uid()
  );

commit;
