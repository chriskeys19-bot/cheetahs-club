-- Schedule sync-splitwise every 12 hours.
--
-- pg_cron reads a random secret from Vault and sends it as x-splitwise-cron.
-- The Edge Function reads that same Vault row through splitwise_cron_secret(),
-- which only the service role can execute. Nothing here requires pasting
-- SPLITWISE_CRON_SECRET into the dashboard. The service role key is not sent.
-- pg_net can leave the cron header in net.http_request_queue until the request
-- is sent, so the header is this dedicated secret and not a database key.
--
-- Successful copies record synced_at and sync_source (scheduled, manual, or
-- service). A failed attempt sets last_attempt_failed and leaves synced_at
-- on the previous success. Players can read those columns. They cannot read
-- the staff-only sync_error text.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'project_url') then
    perform vault.create_secret(
      'https://lutcbvzunjcosncvdyke.supabase.co',
      'project_url',
      'API URL for scheduled Edge Function calls'
    );
  end if;

  if not exists (select 1 from vault.secrets where name = 'splitwise_cron_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'splitwise_cron_secret',
      'Authorizes pg_cron calls to sync-splitwise. Not the service role key.'
    );
  end if;
end
$$;

do $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'project_url';
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'splitwise_cron_secret';
  if v_url is null or v_url !~ '^https://' then
    raise exception 'project_url is missing from Vault';
  end if;
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'splitwise_cron_secret is missing from Vault';
  end if;
end
$$;

alter table public.splitwise_meta
  add column sync_source text,
  add column last_attempt_at timestamptz,
  add column last_attempt_failed boolean not null default false;

alter table public.splitwise_meta
  add constraint splitwise_meta_sync_source_check
  check (sync_source is null or sync_source in ('scheduled', 'manual', 'service'));

comment on column public.splitwise_meta.synced_at is
  'When the last successful Splitwise copy finished. A later failure does not clear it.';

comment on column public.splitwise_meta.sync_source is
  'Who produced the last successful copy: scheduled (pg_cron), manual (captain or admin refresh), or service (refresh after adding a member).';

comment on column public.splitwise_meta.last_attempt_at is
  'When the last attempt finished, successful or not.';

comment on column public.splitwise_meta.last_attempt_failed is
  'True when the last attempt failed. synced_at still names the last success. The error text stays on splitwise_status, which players cannot read.';

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
  v_source text;
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
    update public.splitwise_meta
      set last_attempt_at = now(),
          last_attempt_failed = true
      where id = 1;
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

  v_source := nullif(btrim(coalesce(payload->>'sync_source', '')), '');
  if v_source is not null and v_source not in ('scheduled', 'manual', 'service') then
    raise exception 'sync_source must be scheduled, manual, or service' using errcode = '22023';
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

  insert into public.splitwise_meta as meta (
    id,
    group_id,
    group_name,
    currency,
    venmo_username,
    synced_at,
    sync_source,
    last_attempt_at,
    last_attempt_failed
  )
  values (1, v_group_id, v_group_name, 'USD', v_venmo, v_synced, v_source, v_synced, false)
  on conflict (id) do update
    set group_id = excluded.group_id,
        group_name = excluded.group_name,
        currency = excluded.currency,
        venmo_username = excluded.venmo_username,
        synced_at = excluded.synced_at,
        sync_source = excluded.sync_source,
        last_attempt_at = excluded.last_attempt_at,
        last_attempt_failed = excluded.last_attempt_failed;

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
    'sync_source', v_source,
    'mapped_count', v_mapped,
    'unmapped_count', v_unmapped,
    'member_count', v_members,
    'owed_by_members_cents', v_owed_by,
    'owed_to_members_cents', v_owed_to
  );
end;
$$;

create or replace function private.splitwise_cron_secret()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select decrypted_secret
    into v_secret
  from vault.decrypted_secrets
  where name = 'splitwise_cron_secret'
  limit 1;
  return nullif(btrim(coalesce(v_secret, '')), '');
end;
$$;

revoke all on function private.splitwise_cron_secret() from public;
revoke all on function private.splitwise_cron_secret() from anon;
revoke all on function private.splitwise_cron_secret() from authenticated;
grant execute on function private.splitwise_cron_secret() to service_role;

create or replace function public.splitwise_cron_secret()
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select private.splitwise_cron_secret();
$$;

comment on function public.splitwise_cron_secret() is
  'Service role only. The Vault secret that authorizes a scheduled sync-splitwise call. Authenticated and anon cannot execute it.';

revoke all on function public.splitwise_cron_secret() from public;
revoke all on function public.splitwise_cron_secret() from anon;
revoke all on function public.splitwise_cron_secret() from authenticated;
grant execute on function public.splitwise_cron_secret() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'sync-splitwise-hourly') then
    perform cron.unschedule('sync-splitwise-hourly');
  end if;
end
$$;

select cron.schedule(
  'sync-splitwise-twice-daily',
  '15 */12 * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync-splitwise',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-splitwise-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'splitwise_cron_secret')
    ),
    body := '{"force":false}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

notify pgrst, 'reload schema';
