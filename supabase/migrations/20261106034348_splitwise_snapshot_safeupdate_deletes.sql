-- pg-safeupdate rejects DELETE without WHERE on API sessions.
-- That broke private.replace_splitwise_snapshot during Splitwise refresh.
-- Already applied on project lutcbvzunjcosncvdyke (version 20261106034348).
-- The original snapshot migration is patched the same way for a fresh database.

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
