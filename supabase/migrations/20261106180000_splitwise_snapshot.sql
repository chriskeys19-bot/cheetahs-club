-- Splitwise snapshot for dues. The Cheetahs Splitwise group is the ledger.
-- This migration only stores a copy. The browser never sees the API key.
--
-- Apply to project lutcbvzunjcosncvdyke before using Refresh on Dues.
-- Do not put SPLITWISE_API_KEY, OAuth secrets, or the service role in git.
--
-- Access (RLS forced; anon has no grants; authenticated can only select):
--   splitwise_meta
--     select: any signed-in member (group name, Venmo handle, synced_at)
--   splitwise_balances
--     select: the mapped member, or admin/captain
--   splitwise_expenses
--     select: a member who has a share on that expense, or admin/captain
--   splitwise_shares
--     select: the mapped member, or admin/captain
--   splitwise_debts, splitwise_status
--     select: admin/captain (club rollups and who-owes-whom stay staff-only)
--   writes: service role only, through public.replace_splitwise_snapshot
--
-- balance_cents is signed USD cents. Negative means that member owes the
-- group. Positive means the group owes that member. 1250 is $12.50.
-- Email match is done in the sync-splitwise Edge Function, not here.
-- Players cannot read another member's row.

create table public.splitwise_meta (
  id integer primary key,
  group_id bigint,
  group_name text,
  currency text not null default 'USD',
  venmo_username text not null default 'cheetahs',
  synced_at timestamptz,
  constraint splitwise_meta_singleton check (id = 1),
  constraint splitwise_meta_group_id_positive check (group_id is null or group_id > 0),
  constraint splitwise_meta_group_name_length check (
    group_name is null or char_length(group_name) between 1 and 200
  ),
  constraint splitwise_meta_currency_usd check (currency = 'USD'),
  constraint splitwise_meta_venmo_username_shape check (
    venmo_username ~ '^[A-Za-z0-9_-]{1,30}$'
  )
);

comment on table public.splitwise_meta is
  'One row. Public-to-members facts from the last Splitwise refresh: group name, Venmo handle, and when the copy was taken. No balances and no API key.';

comment on column public.splitwise_meta.venmo_username is
  'Club Venmo handle without @. Written by sync from the VENMO_USERNAME secret, or the placeholder cheetahs.';

create table public.splitwise_status (
  id integer primary key,
  sync_error text,
  account_label text,
  owed_by_members_cents integer not null default 0,
  owed_to_members_cents integer not null default 0,
  unmapped_count integer not null default 0,
  mapped_count integer not null default 0,
  member_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz,
  constraint splitwise_status_singleton check (id = 1),
  constraint splitwise_status_sync_error_length check (
    sync_error is null or char_length(sync_error) between 1 and 500
  ),
  constraint splitwise_status_account_label_length check (
    account_label is null or char_length(account_label) between 1 and 120
  ),
  constraint splitwise_status_counts_nonnegative check (
    owed_by_members_cents >= 0
    and owed_to_members_cents >= 0
    and owed_by_members_cents <= 1000000000
    and owed_to_members_cents <= 1000000000
    and unmapped_count >= 0
    and mapped_count >= 0
    and member_count >= 0
    and member_count <= 300
  ),
  constraint splitwise_status_detail_object check (jsonb_typeof(detail) = 'object')
);

comment on table public.splitwise_status is
  'Staff-only sync health and club rollup. owed_by_members_cents is how much members owe the group in USD cents.';

create table public.splitwise_balances (
  splitwise_user_id bigint primary key,
  profile_id uuid references public.profiles (id) on delete set null,
  email text,
  display_name text not null,
  balance_cents integer not null,
  currency text not null default 'USD',
  synced_at timestamptz not null,
  constraint splitwise_balances_user_positive check (splitwise_user_id > 0),
  constraint splitwise_balances_currency_usd check (currency = 'USD'),
  constraint splitwise_balances_amount_range check (
    balance_cents between -100000000 and 100000000
  ),
  constraint splitwise_balances_name_length check (char_length(display_name) between 1 and 120),
  constraint splitwise_balances_email_shape check (
    email is null
    or (
      char_length(email) between 3 and 320
      and email = lower(email)
      and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    )
  )
);

comment on table public.splitwise_balances is
  'One current row per Splitwise group member. A player can read only the row mapped to their profile. Negative balance_cents means they owe the group.';

comment on column public.splitwise_balances.balance_cents is
  'Signed USD cents from Splitwise. Negative: this member owes the group. Positive: the group owes this member.';

comment on column public.splitwise_balances.profile_id is
  'Cheetahs profile matched by email during sync. Null means the Splitwise email did not match a club account.';

create index splitwise_balances_profile_id_idx
  on public.splitwise_balances (profile_id)
  where profile_id is not null;

create table public.splitwise_expenses (
  splitwise_expense_id bigint primary key,
  description text not null,
  cost_cents integer not null,
  currency text not null default 'USD',
  expense_at timestamptz not null,
  is_payment boolean not null default false,
  synced_at timestamptz not null,
  constraint splitwise_expenses_id_positive check (splitwise_expense_id > 0),
  constraint splitwise_expenses_currency_usd check (currency = 'USD'),
  constraint splitwise_expenses_cost_range check (cost_cents >= 0 and cost_cents <= 100000000),
  constraint splitwise_expenses_description_length check (char_length(description) between 1 and 240)
);

comment on table public.splitwise_expenses is
  'Recent Splitwise expenses and settlements copied for display. Edit them in Splitwise. is_payment marks a settlement, not a new cost.';

create table public.splitwise_shares (
  splitwise_expense_id bigint not null references public.splitwise_expenses (splitwise_expense_id) on delete cascade,
  splitwise_user_id bigint not null,
  profile_id uuid references public.profiles (id) on delete set null,
  paid_cents integer not null,
  owed_cents integer not null,
  primary key (splitwise_expense_id, splitwise_user_id),
  constraint splitwise_shares_user_positive check (splitwise_user_id > 0),
  constraint splitwise_shares_paid_range check (paid_cents >= 0 and paid_cents <= 100000000),
  constraint splitwise_shares_owed_range check (owed_cents >= 0 and owed_cents <= 100000000)
);

comment on table public.splitwise_shares is
  'What each Splitwise member paid and owed on a copied expense. A player can read only their mapped share.';

create index splitwise_shares_profile_expense_idx
  on public.splitwise_shares (profile_id, splitwise_expense_id)
  where profile_id is not null;

create table public.splitwise_debts (
  id bigint generated always as identity primary key,
  from_splitwise_user_id bigint not null,
  to_splitwise_user_id bigint not null,
  from_profile_id uuid references public.profiles (id) on delete set null,
  to_profile_id uuid references public.profiles (id) on delete set null,
  amount_cents integer not null,
  currency text not null default 'USD',
  synced_at timestamptz not null,
  constraint splitwise_debts_users_positive check (
    from_splitwise_user_id > 0 and to_splitwise_user_id > 0
  ),
  constraint splitwise_debts_amount_range check (amount_cents > 0 and amount_cents <= 100000000),
  constraint splitwise_debts_currency_usd check (currency = 'USD')
);

comment on table public.splitwise_debts is
  'Staff-only simplified USD debts from the Splitwise group. from owes to. The player pay button uses the member balance, not this list.';

create index splitwise_debts_from_profile_id_idx
  on public.splitwise_debts (from_profile_id);

create index splitwise_debts_to_profile_id_idx
  on public.splitwise_debts (to_profile_id);

create or replace function private.replace_splitwise_snapshot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_synced timestamptz;
  v_group_id bigint;
  v_group_name text;
  v_venmo text;
  v_account text;
  v_detail jsonb;
  v_owed_by bigint;
  v_owed_to bigint;
  v_unmapped integer;
  v_mapped integer;
  v_members integer;
  v_balance_count integer;
  v_debt_count integer;
  v_expense_count integer;
  v_share_count integer;
  v_error text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'snapshot payload required' using errcode = '22023';
  end if;
  if octet_length(payload::text) > 500000 then
    raise exception 'snapshot is too large' using errcode = '22023';
  end if;

  if payload->>'mode' = 'error' then
    v_error := btrim(coalesce(payload->>'sync_error', ''));
    if char_length(v_error) < 1 or char_length(v_error) > 500 then
      raise exception 'sync error must be 1 to 500 characters' using errcode = '22023';
    end if;
    insert into public.splitwise_status as status (id, sync_error, updated_at)
    values (1, v_error, now())
    on conflict (id) do update
      set sync_error = excluded.sync_error,
          updated_at = excluded.updated_at;
    return jsonb_build_object('ok', false);
  end if;

  if payload->>'mode' is distinct from 'replace' then
    raise exception 'unknown snapshot mode' using errcode = '22023';
  end if;
  if jsonb_typeof(payload->'balances') is distinct from 'array'
    or jsonb_typeof(payload->'debts') is distinct from 'array'
    or jsonb_typeof(payload->'expenses') is distinct from 'array'
    or jsonb_typeof(payload->'shares') is distinct from 'array'
  then
    raise exception 'snapshot lists must be arrays' using errcode = '22023';
  end if;

  v_balance_count := jsonb_array_length(payload->'balances');
  v_debt_count := jsonb_array_length(payload->'debts');
  v_expense_count := jsonb_array_length(payload->'expenses');
  v_share_count := jsonb_array_length(payload->'shares');
  if v_balance_count > 300 or v_debt_count > 1000 or v_expense_count > 40 or v_share_count > 2000 then
    raise exception 'snapshot list is over the club limit' using errcode = '22023';
  end if;

  v_synced := (payload->>'synced_at')::timestamptz;
  if v_synced is null then
    raise exception 'synced_at required' using errcode = '22023';
  end if;

  v_group_id := nullif(payload->>'group_id', '')::bigint;
  if v_group_id is null or v_group_id <= 0 then
    raise exception 'group id required' using errcode = '22023';
  end if;

  v_group_name := nullif(btrim(coalesce(payload->>'group_name', '')), '');
  v_venmo := btrim(coalesce(payload->>'venmo_username', ''));
  v_account := nullif(btrim(coalesce(payload->>'account_label', '')), '');
  v_detail := payload->'detail';
  if v_detail is null or jsonb_typeof(v_detail) <> 'object' then
    v_detail := '{}'::jsonb;
  end if;
  if octet_length(v_detail::text) > 12000 then
    raise exception 'detail is too large' using errcode = '22023';
  end if;

  perform 1
  from public.splitwise_meta
  where id = 1
  for update;

  -- WHERE true satisfies pg-safeupdate on API sessions.
  delete from public.splitwise_shares where true;
  delete from public.splitwise_expenses where true;
  delete from public.splitwise_debts where true;
  delete from public.splitwise_balances where true;

  insert into public.splitwise_balances (
    splitwise_user_id,
    profile_id,
    email,
    display_name,
    balance_cents,
    currency,
    synced_at
  )
  select
    (item->>'splitwise_user_id')::bigint,
    nullif(item->>'profile_id', '')::uuid,
    nullif(lower(btrim(coalesce(item->>'email', ''))), ''),
    btrim(item->>'display_name'),
    (item->>'balance_cents')::integer,
    'USD',
    v_synced
  from jsonb_array_elements(payload->'balances') as item;

  insert into public.splitwise_expenses (
    splitwise_expense_id,
    description,
    cost_cents,
    currency,
    expense_at,
    is_payment,
    synced_at
  )
  select
    (item->>'splitwise_expense_id')::bigint,
    btrim(item->>'description'),
    (item->>'cost_cents')::integer,
    'USD',
    (item->>'expense_at')::timestamptz,
    coalesce((item->>'is_payment')::boolean, false),
    v_synced
  from jsonb_array_elements(payload->'expenses') as item;

  insert into public.splitwise_shares (
    splitwise_expense_id,
    splitwise_user_id,
    profile_id,
    paid_cents,
    owed_cents
  )
  select
    (item->>'splitwise_expense_id')::bigint,
    (item->>'splitwise_user_id')::bigint,
    nullif(item->>'profile_id', '')::uuid,
    (item->>'paid_cents')::integer,
    (item->>'owed_cents')::integer
  from jsonb_array_elements(payload->'shares') as item;

  insert into public.splitwise_debts (
    from_splitwise_user_id,
    to_splitwise_user_id,
    from_profile_id,
    to_profile_id,
    amount_cents,
    currency,
    synced_at
  )
  select
    (item->>'from_splitwise_user_id')::bigint,
    (item->>'to_splitwise_user_id')::bigint,
    nullif(item->>'from_profile_id', '')::uuid,
    nullif(item->>'to_profile_id', '')::uuid,
    (item->>'amount_cents')::integer,
    'USD',
    v_synced
  from jsonb_array_elements(payload->'debts') as item;

  select
    coalesce(sum(case when balance.balance_cents < 0 then -balance.balance_cents else 0 end), 0),
    coalesce(sum(case when balance.balance_cents > 0 then balance.balance_cents else 0 end), 0),
    count(*) filter (where balance.profile_id is null),
    count(*) filter (where balance.profile_id is not null),
    count(*)
  into v_owed_by, v_owed_to, v_unmapped, v_mapped, v_members
  from public.splitwise_balances as balance;

  if v_owed_by > 1000000000 or v_owed_to > 1000000000 then
    raise exception 'balances are too large' using errcode = '22023';
  end if;

  insert into public.splitwise_meta as meta (id, group_id, group_name, currency, venmo_username, synced_at)
  values (1, v_group_id, v_group_name, 'USD', v_venmo, v_synced)
  on conflict (id) do update
    set group_id = excluded.group_id,
        group_name = excluded.group_name,
        currency = excluded.currency,
        venmo_username = excluded.venmo_username,
        synced_at = excluded.synced_at;

  insert into public.splitwise_status as status (
    id,
    sync_error,
    account_label,
    owed_by_members_cents,
    owed_to_members_cents,
    unmapped_count,
    mapped_count,
    member_count,
    detail,
    updated_at
  )
  values (
    1,
    null,
    v_account,
    v_owed_by::integer,
    v_owed_to::integer,
    v_unmapped,
    v_mapped,
    v_members,
    v_detail,
    v_synced
  )
  on conflict (id) do update
    set sync_error = null,
        account_label = excluded.account_label,
        owed_by_members_cents = excluded.owed_by_members_cents,
        owed_to_members_cents = excluded.owed_to_members_cents,
        unmapped_count = excluded.unmapped_count,
        mapped_count = excluded.mapped_count,
        member_count = excluded.member_count,
        detail = excluded.detail,
        updated_at = excluded.updated_at;

  return jsonb_build_object(
    'ok', true,
    'group_name', v_group_name,
    'synced_at', v_synced,
    'mapped_count', v_mapped,
    'unmapped_count', v_unmapped,
    'member_count', v_members,
    'owed_by_members_cents', v_owed_by,
    'owed_to_members_cents', v_owed_to
  );
end;
$$;

revoke all on function private.replace_splitwise_snapshot(jsonb) from public;
revoke all on function private.replace_splitwise_snapshot(jsonb) from anon;
revoke all on function private.replace_splitwise_snapshot(jsonb) from authenticated;
grant execute on function private.replace_splitwise_snapshot(jsonb) to service_role;

create or replace function public.replace_splitwise_snapshot(payload jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.replace_splitwise_snapshot(payload);
$$;

comment on function public.replace_splitwise_snapshot(jsonb) is
  'Service role only. Replaces the Splitwise copy or records a sync error. Authenticated and anon cannot execute it.';

revoke all on function public.replace_splitwise_snapshot(jsonb) from public;
revoke all on function public.replace_splitwise_snapshot(jsonb) from anon;
revoke all on function public.replace_splitwise_snapshot(jsonb) from authenticated;
grant execute on function public.replace_splitwise_snapshot(jsonb) to service_role;

grant usage on schema private to service_role;

alter table public.splitwise_meta enable row level security;
alter table public.splitwise_status enable row level security;
alter table public.splitwise_balances enable row level security;
alter table public.splitwise_expenses enable row level security;
alter table public.splitwise_shares enable row level security;
alter table public.splitwise_debts enable row level security;

alter table public.splitwise_meta force row level security;
alter table public.splitwise_status force row level security;
alter table public.splitwise_balances force row level security;
alter table public.splitwise_expenses force row level security;
alter table public.splitwise_shares force row level security;
alter table public.splitwise_debts force row level security;

revoke all on table public.splitwise_meta from public;
revoke all on table public.splitwise_meta from anon;
revoke all on table public.splitwise_meta from authenticated;
grant select on table public.splitwise_meta to authenticated;
grant select, insert, update, delete on table public.splitwise_meta to service_role;

revoke all on table public.splitwise_status from public;
revoke all on table public.splitwise_status from anon;
revoke all on table public.splitwise_status from authenticated;
grant select on table public.splitwise_status to authenticated;
grant select, insert, update, delete on table public.splitwise_status to service_role;

revoke all on table public.splitwise_balances from public;
revoke all on table public.splitwise_balances from anon;
revoke all on table public.splitwise_balances from authenticated;
grant select on table public.splitwise_balances to authenticated;
grant select, insert, update, delete on table public.splitwise_balances to service_role;

revoke all on table public.splitwise_expenses from public;
revoke all on table public.splitwise_expenses from anon;
revoke all on table public.splitwise_expenses from authenticated;
grant select on table public.splitwise_expenses to authenticated;
grant select, insert, update, delete on table public.splitwise_expenses to service_role;

revoke all on table public.splitwise_shares from public;
revoke all on table public.splitwise_shares from anon;
revoke all on table public.splitwise_shares from authenticated;
grant select on table public.splitwise_shares to authenticated;
grant select, insert, update, delete on table public.splitwise_shares to service_role;

revoke all on table public.splitwise_debts from public;
revoke all on table public.splitwise_debts from anon;
revoke all on table public.splitwise_debts from authenticated;
grant select on table public.splitwise_debts to authenticated;
grant select, insert, update, delete on table public.splitwise_debts to service_role;

create policy splitwise_meta_select_member on public.splitwise_meta
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy splitwise_meta_select_member on public.splitwise_meta is
  'Any signed-in member can read the group name, Venmo handle, and last refresh time.';

create policy splitwise_status_select_staff on public.splitwise_status
  for select to authenticated
  using ((select private.is_staff()));

comment on policy splitwise_status_select_staff on public.splitwise_status is
  'Club rollup totals and sync errors are admin and captain only.';

create policy splitwise_balances_select_own_or_staff on public.splitwise_balances
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy splitwise_balances_select_own_or_staff on public.splitwise_balances is
  'A member reads the Splitwise row mapped to them. Admin and captain read every row, including unmapped emails.';

create policy splitwise_expenses_select_own_or_staff on public.splitwise_expenses
  for select to authenticated
  using (
    (select private.is_staff())
    or exists (
      select 1
      from public.splitwise_shares as share
      where share.splitwise_expense_id = splitwise_expenses.splitwise_expense_id
        and share.profile_id = (select auth.uid())
    )
  );

comment on policy splitwise_expenses_select_own_or_staff on public.splitwise_expenses is
  'A member reads a copied expense only when one of their shares is on it. Admin and captain read the recent list.';

create policy splitwise_shares_select_own_or_staff on public.splitwise_shares
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy splitwise_shares_select_own_or_staff on public.splitwise_shares is
  'A member reads their own share. Admin and captain read every share.';

create policy splitwise_debts_select_staff on public.splitwise_debts
  for select to authenticated
  using ((select private.is_staff()));

comment on policy splitwise_debts_select_staff on public.splitwise_debts is
  'Who owes whom across the group is admin and captain only.';

insert into public.splitwise_meta (id, venmo_username)
values (1, 'cheetahs');

insert into public.splitwise_status (id, detail)
values (1, '{}'::jsonb);

notify pgrst, 'reload schema';
