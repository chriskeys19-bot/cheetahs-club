-- Phase 3: in-app dues ledger (no payment-provider checkout).
--
-- Amount columns are integer USD cents (1250 = $12.50). Currency is USD.
-- Apply this file to project lutcbvzunjcosncvdyke before using the Dues page:
--   supabase db push
-- or paste it into the Supabase SQL editor. Do not put keys in the pull request.
--
-- Access matrix (RLS, role authenticated only; anon has no grants):
--   expenses
--     select: admin/captain, or a member who has a dues row linked to that expense
--     insert / update / delete: admin or captain (private.is_staff)
--   dues_assessments
--     select: the member the row is for, or admin/captain
--     insert / update / delete: admin or captain
--   dues_payments
--     select: the payer, or admin/captain
--     insert: admin/captain, or the member on their own open assessment
--       (a member insert is forced to claim_status pending_claim)
--     update: admin or captain (confirm a claim here)
--     delete: admin/captain, or the payer while the row is still pending_claim
--
-- Roles come from public.profiles through private.is_staff / private.current_role.
-- Policies never read user_metadata.
-- Identity columns are stamped from auth.uid() in private triggers.
-- A pending claim counts toward the open balance so two full claims cannot both land.
-- Confirmed payments that cover the assessment set status to paid.
-- Waived and cancelled rows stay that way until a captain changes them.
-- public.dues_roster() lets captains and admins read member names for the
-- assess form without widening profiles SELECT (admins already have their own
-- member list; captains otherwise only see their own profile).

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  amount integer not null,
  currency text not null default 'USD',
  expense_date date not null,
  category text,
  notes text,
  team_id uuid references public.teams (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint expenses_amount_positive check (amount > 0 and amount <= 100000000),
  constraint expenses_currency_usd check (currency = 'USD'),
  constraint expenses_title_length check (char_length(title) between 1 and 140),
  constraint expenses_category_length check (
    category is null or char_length(category) between 1 and 40
  ),
  constraint expenses_notes_length check (
    notes is null or char_length(notes) between 1 and 500
  )
);

comment on table public.expenses is
  'Club costs. Amount is USD cents. Null team_id means club-wide. Archived rows stay on record and drop out of the active total.';

comment on column public.expenses.amount is
  'USD cents. 1250 is $12.50.';

create index expenses_expense_date_idx
  on public.expenses (expense_date desc);

create index expenses_team_id_idx
  on public.expenses (team_id);

create index expenses_created_by_idx
  on public.expenses (created_by);

create table public.dues_assessments (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  amount integer not null,
  due_date date not null,
  period_label text not null,
  team_id uuid references public.teams (id) on delete set null,
  member_id uuid not null references public.profiles (id) on delete cascade,
  expense_id uuid references public.expenses (id) on delete set null,
  status text not null default 'open',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dues_assessments_amount_positive check (amount > 0 and amount <= 100000000),
  constraint dues_assessments_title_length check (char_length(title) between 1 and 140),
  constraint dues_assessments_description_length check (
    description is null or char_length(description) between 1 and 2000
  ),
  constraint dues_assessments_period_length check (char_length(period_label) between 1 and 40),
  constraint dues_assessments_status_check check (status in ('open', 'paid', 'waived', 'cancelled'))
);

comment on table public.dues_assessments is
  'What a member owes. Amount is USD cents. Null team_id means club-wide. Status paid is set when confirmed payments cover the amount.';

comment on column public.dues_assessments.amount is
  'USD cents. 1250 is $12.50.';

create index dues_assessments_member_id_idx
  on public.dues_assessments (member_id);

create index dues_assessments_status_idx
  on public.dues_assessments (status);

create index dues_assessments_due_date_idx
  on public.dues_assessments (due_date);

create index dues_assessments_team_id_idx
  on public.dues_assessments (team_id);

create index dues_assessments_expense_member_idx
  on public.dues_assessments (expense_id, member_id);

create index dues_assessments_created_by_idx
  on public.dues_assessments (created_by);

create index dues_assessments_open_due_idx
  on public.dues_assessments (member_id, due_date)
  where status = 'open';

create table public.dues_payments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.dues_assessments (id) on delete cascade,
  amount integer not null,
  paid_at timestamptz not null default now(),
  method_note text,
  recorded_by uuid references auth.users (id) on delete set null,
  claim_status text not null default 'pending_claim',
  payer_user_id uuid references auth.users (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  constraint dues_payments_amount_positive check (amount > 0 and amount <= 100000000),
  constraint dues_payments_claim_status_check check (claim_status in ('confirmed', 'pending_claim')),
  constraint dues_payments_method_note_length check (
    method_note is null or char_length(method_note) between 1 and 160
  ),
  constraint dues_payments_notes_length check (
    notes is null or char_length(notes) between 1 and 500
  )
);

comment on table public.dues_payments is
  'Money recorded against one dues row. pending_claim is a member saying they paid. confirmed counts toward paid. method_note is free text such as Venmo @cheetahs. No processor is called.';

comment on column public.dues_payments.amount is
  'USD cents. 1250 is $12.50.';

create index dues_payments_assessment_id_idx
  on public.dues_payments (assessment_id);

create index dues_payments_payer_user_id_idx
  on public.dues_payments (payer_user_id);

create index dues_payments_recorded_by_idx
  on public.dues_payments (recorded_by);

create index dues_payments_pending_idx
  on public.dues_payments (created_at)
  where claim_status = 'pending_claim';

create or replace function private.stamp_expense()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  new.currency := 'USD';
  if new.category is not null then
    new.category := nullif(btrim(new.category), '');
  end if;
  if new.notes is not null then
    new.notes := nullif(btrim(new.notes), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
    new.archived_at := null;
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_expense() from public;
revoke all on function private.stamp_expense() from anon;
grant execute on function private.stamp_expense() to authenticated;
grant execute on function private.stamp_expense() to service_role;

create trigger expenses_stamp
  before insert or update on public.expenses
  for each row
  execute function private.stamp_expense();

create or replace function private.stamp_dues_assessment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  new.period_label := btrim(new.period_label);
  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
    if new.status = 'paid' then
      new.status := 'open';
    end if;
  else
    if new.member_id is distinct from old.member_id then
      raise exception 'member cannot change' using errcode = '42501';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_dues_assessment() from public;
revoke all on function private.stamp_dues_assessment() from anon;
grant execute on function private.stamp_dues_assessment() to authenticated;
grant execute on function private.stamp_dues_assessment() to service_role;

create trigger dues_assessments_stamp
  before insert or update on public.dues_assessments
  for each row
  execute function private.stamp_dues_assessment();

create or replace function private.sync_dues_assessment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_amount integer;
  v_status text;
  v_confirmed bigint;
begin
  -- The status update below fires dues_assessments_sync. That trigger bails
  -- while this flag is set so the sync cannot call itself.
  perform set_config('dues.syncing', '1', true);

  select a.amount, a.status
    into v_amount, v_status
  from public.dues_assessments as a
  where a.id = p_id
  for update;

  if found and v_status not in ('waived', 'cancelled') then
    select coalesce(sum(p.amount), 0)
      into v_confirmed
    from public.dues_payments as p
    where p.assessment_id = p_id
      and p.claim_status = 'confirmed';

    if v_confirmed >= v_amount and v_status is distinct from 'paid' then
      update public.dues_assessments
        set status = 'paid'
        where id = p_id;
    elsif v_confirmed < v_amount and v_status is distinct from 'open' then
      update public.dues_assessments
        set status = 'open'
        where id = p_id;
    end if;
  end if;

  perform set_config('dues.syncing', '', true);
exception
  when others then
    perform set_config('dues.syncing', '', true);
    raise;
end;
$$;

revoke all on function private.sync_dues_assessment(uuid) from public;
revoke all on function private.sync_dues_assessment(uuid) from anon;
grant execute on function private.sync_dues_assessment(uuid) to authenticated;
grant execute on function private.sync_dues_assessment(uuid) to service_role;

create or replace function private.dues_assessments_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('dues.syncing', true), '') = '1' then
    return new;
  end if;
  perform private.sync_dues_assessment(new.id);
  return new;
end;
$$;

revoke all on function private.dues_assessments_after() from public;
revoke all on function private.dues_assessments_after() from anon;
grant execute on function private.dues_assessments_after() to authenticated;
grant execute on function private.dues_assessments_after() to service_role;

create trigger dues_assessments_sync
  after insert or update of amount, status on public.dues_assessments
  for each row
  execute function private.dues_assessments_after();

create or replace function private.guard_dues_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member uuid;
  v_status text;
  v_amount integer;
  v_staff boolean;
  v_committed bigint;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  v_staff := (select private.is_staff());

  select a.member_id, a.status, a.amount
    into v_member, v_status, v_amount
  from public.dues_assessments as a
  where a.id = new.assessment_id
  for update;

  if not found then
    raise exception 'assessment not found' using errcode = '23503';
  end if;

  if not v_staff and v_member is distinct from (select auth.uid()) then
    raise exception 'not your assessment' using errcode = '42501';
  end if;
  if not v_staff and tg_op = 'UPDATE' then
    raise exception 'players cannot edit payments' using errcode = '42501';
  end if;
  if v_status is distinct from 'open' then
    raise exception 'assessment is closed' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.assessment_id is distinct from old.assessment_id then
    raise exception 'assessment cannot change' using errcode = '42501';
  end if;

  new.payer_user_id := v_member;
  if new.method_note is not null then
    new.method_note := nullif(btrim(new.method_note), '');
  end if;
  if new.notes is not null then
    new.notes := nullif(btrim(new.notes), '');
  end if;
  if new.paid_at is null then
    new.paid_at := now();
  end if;
  if new.claim_status is null or not v_staff then
    new.claim_status := 'pending_claim';
  end if;

  if tg_op = 'INSERT' then
    new.recorded_by := (select auth.uid());
    new.created_at := now();
  else
    new.recorded_by := old.recorded_by;
    new.created_at := old.created_at;
  end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'amount must be positive' using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' then
    select coalesce(sum(p.amount), 0)
      into v_committed
    from public.dues_payments as p
    where p.assessment_id = new.assessment_id
      and p.id is distinct from new.id;
  else
    select coalesce(sum(p.amount), 0)
      into v_committed
    from public.dues_payments as p
    where p.assessment_id = new.assessment_id;
  end if;

  if v_committed + new.amount > v_amount then
    raise exception 'payment exceeds amount owed' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_dues_payment() from public;
revoke all on function private.guard_dues_payment() from anon;
grant execute on function private.guard_dues_payment() to authenticated;
grant execute on function private.guard_dues_payment() to service_role;

create trigger dues_payments_guard
  before insert or update on public.dues_payments
  for each row
  execute function private.guard_dues_payment();

create or replace function private.dues_payments_after()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if tg_op = 'DELETE' then
    v_id := old.assessment_id;
  else
    v_id := new.assessment_id;
  end if;
  perform private.sync_dues_assessment(v_id);
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function private.dues_payments_after() from public;
revoke all on function private.dues_payments_after() from anon;
grant execute on function private.dues_payments_after() to authenticated;
grant execute on function private.dues_payments_after() to service_role;

create trigger dues_payments_sync
  after insert or update or delete on public.dues_payments
  for each row
  execute function private.dues_payments_after();

create or replace function private.dues_roster()
returns table (id uuid, full_name text, role text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role
  from public.profiles as p
  where (select auth.uid()) is not null
    and (select private.is_staff())
  order by lower(coalesce(nullif(btrim(p.full_name), ''), p.id::text));
$$;

revoke all on function private.dues_roster() from public;
revoke all on function private.dues_roster() from anon;
grant execute on function private.dues_roster() to authenticated;
grant execute on function private.dues_roster() to service_role;

create or replace function public.dues_roster()
returns table (id uuid, full_name text, role text)
language sql
stable
security invoker
set search_path = ''
as $$
  select roster.id, roster.full_name, roster.role
  from private.dues_roster() as roster;
$$;

comment on function public.dues_roster() is
  'Member id, name, and role for captains and admins assessing dues. Does not return email. Reads profiles through private.dues_roster() as security definer. Players get no rows.';

revoke all on function public.dues_roster() from public;
revoke all on function public.dues_roster() from anon;
grant execute on function public.dues_roster() to authenticated;
grant execute on function public.dues_roster() to service_role;

alter table public.expenses enable row level security;
alter table public.dues_assessments enable row level security;
alter table public.dues_payments enable row level security;

alter table public.expenses force row level security;
alter table public.dues_assessments force row level security;
alter table public.dues_payments force row level security;

revoke all on table public.expenses from public;
revoke all on table public.expenses from anon;
revoke all on table public.expenses from authenticated;
grant select, insert, update, delete on table public.expenses to authenticated;
grant select, insert, update, delete on table public.expenses to service_role;

revoke all on table public.dues_assessments from public;
revoke all on table public.dues_assessments from anon;
revoke all on table public.dues_assessments from authenticated;
grant select, insert, update, delete on table public.dues_assessments to authenticated;
grant select, insert, update, delete on table public.dues_assessments to service_role;

revoke all on table public.dues_payments from public;
revoke all on table public.dues_payments from anon;
revoke all on table public.dues_payments from authenticated;
grant select, insert, update, delete on table public.dues_payments to authenticated;
grant select, insert, update, delete on table public.dues_payments to service_role;

create policy expenses_select_staff_or_linked on public.expenses
  for select to authenticated
  using (
    (select private.is_staff())
    or exists (
      select 1
      from public.dues_assessments as a
      where a.expense_id = expenses.id
        and a.member_id = (select auth.uid())
    )
  );

comment on policy expenses_select_staff_or_linked on public.expenses is
  'Captains and admins read every expense. A player reads an expense only when one of their dues rows links to it.';

create policy expenses_insert_staff on public.expenses
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy expenses_insert_staff on public.expenses is
  'Admin and captain can log expenses. The stamp trigger sets created_by.';

create policy expenses_update_staff on public.expenses
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy expenses_update_staff on public.expenses is
  'Admin and captain can edit or archive expenses.';

create policy expenses_delete_staff on public.expenses
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy expenses_delete_staff on public.expenses is
  'Admin and captain can delete an expense. Linked dues keep their rows with expense_id cleared.';

create policy dues_assessments_select_own_or_staff on public.dues_assessments
  for select to authenticated
  using (
    member_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy dues_assessments_select_own_or_staff on public.dues_assessments is
  'A member reads their own dues. Admin and captain read every row.';

create policy dues_assessments_insert_staff on public.dues_assessments
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy dues_assessments_insert_staff on public.dues_assessments is
  'Admin and captain assess dues. The stamp trigger sets created_by.';

create policy dues_assessments_update_staff on public.dues_assessments
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy dues_assessments_update_staff on public.dues_assessments is
  'Admin and captain can edit a due, waive it, or cancel it. Member cannot be reassigned.';

create policy dues_assessments_delete_staff on public.dues_assessments
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy dues_assessments_delete_staff on public.dues_assessments is
  'Admin and captain can delete a due. Payments on it cascade.';

create policy dues_payments_select_own_or_staff on public.dues_payments
  for select to authenticated
  using (
    payer_user_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy dues_payments_select_own_or_staff on public.dues_payments is
  'A member reads payments where they are the payer. Admin and captain read every payment.';

create policy dues_payments_insert_staff on public.dues_payments
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy dues_payments_insert_staff on public.dues_payments is
  'Admin and captain can record a confirmed payment or a claim. The guard stamps the payer from the dues row.';

create policy dues_payments_insert_own_claim on public.dues_payments
  for insert to authenticated
  with check (
    claim_status = 'pending_claim'
    and payer_user_id = (select auth.uid())
    and exists (
      select 1
      from public.dues_assessments as a
      where a.id = dues_payments.assessment_id
        and a.member_id = (select auth.uid())
        and a.status = 'open'
    )
  );

comment on policy dues_payments_insert_own_claim on public.dues_payments is
  'A member can file a pending claim on their own open due. The guard rejects confirmed claims from players and amounts over the balance.';

create policy dues_payments_update_staff on public.dues_payments
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy dues_payments_update_staff on public.dues_payments is
  'Admin and captain confirm a pending claim or correct a payment. Players cannot update payments.';

create policy dues_payments_delete_own_pending_or_staff on public.dues_payments
  for delete to authenticated
  using (
    (select private.is_staff())
    or (
      payer_user_id = (select auth.uid())
      and claim_status = 'pending_claim'
    )
  );

comment on policy dues_payments_delete_own_pending_or_staff on public.dues_payments is
  'A member can withdraw their own pending claim. Admin and captain can reject a claim or remove a payment.';

notify pgrst, 'reload schema';
