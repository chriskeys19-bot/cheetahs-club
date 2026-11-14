-- Winter club dues copied from the Google Sheet "Cheetah CC Finance_2026".
--
-- The sheet is the ledger My dues shows. Splitwise keeps its own copy.
-- pg_cron calls sync-finance-sheet hourly with finance_sheet_secret from
-- Vault. That function reads the sheet through an Apps Script web app and
-- replaces the rows here. It never writes to the sheet. Until
-- finance_sheet_url is in Vault, the job runs and changes nothing.
--
-- A player can read only the rows linked to their profile. Captains and
-- admins can read every row, including names that did not match. Admins
-- edit the name map, the Zelle address, the reminder date, and per-member
-- memo tokens. Snapshot tables have no write policy, so a member cannot
-- mark a line paid.

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

  if not exists (select 1 from vault.secrets where name = 'finance_sheet_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'finance_sheet_secret',
      'Shared with the finance Apps Script and pg_cron. Not the service role key.'
    );
  end if;
end
$$;

do $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'finance_sheet_secret';
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'finance_sheet_secret is missing from Vault';
  end if;
end
$$;

create table public.finance_dues_settings (
  id smallint primary key check (id = 1),
  zelle_email text not null,
  reminder_mmdd text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint finance_dues_settings_email check (
    char_length(zelle_email) between 6 and 320
    and zelle_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint finance_dues_settings_mmdd check (
    reminder_mmdd ~ '^(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])$'
  )
);

comment on table public.finance_dues_settings is
  'Zelle address and the MMDD used in payment memos. Every signed-in member can read it. Admins update it.';

comment on column public.finance_dues_settings.reminder_mmdd is
  'Latest reminder date as MMDD. The Zelle memo ends with this. 1114 is 14 November.';

create table public.finance_sheet_meta (
  id smallint primary key check (id = 1),
  synced_at timestamptz,
  sync_source text,
  last_attempt_at timestamptz,
  last_attempt_failed boolean not null default false,
  constraint finance_sheet_meta_source check (
    sync_source is null or sync_source in ('scheduled', 'manual')
  )
);

comment on table public.finance_sheet_meta is
  'When the winter sheet was last copied. synced_at stays on the last success. Every signed-in member can read it.';

comment on column public.finance_sheet_meta.synced_at is
  'When the last successful sheet copy finished. A later failure does not clear it.';

create table public.finance_sheet_status (
  id smallint primary key check (id = 1),
  sync_error text,
  unmatched_names jsonb not null default '[]'::jsonb,
  account_count integer not null default 0,
  charge_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint finance_sheet_status_error_length check (
    sync_error is null or char_length(sync_error) between 1 and 500
  ),
  constraint finance_sheet_status_counts check (
    account_count >= 0 and charge_count >= 0
  ),
  constraint finance_sheet_status_unmatched_array check (
    jsonb_typeof(unmatched_names) = 'array'
  )
);

comment on table public.finance_sheet_status is
  'Sync errors and sheet names that did not match a member. Captains and admins only.';

create table public.sheet_name_map (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null,
  sheet_name text not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_by uuid,
  updated_at timestamptz not null default now(),
  constraint sheet_name_map_key_shape check (
    char_length(sheet_key) between 1 and 120
    and sheet_key = lower(btrim(sheet_key))
  ),
  constraint sheet_name_map_name_length check (char_length(btrim(sheet_name)) between 1 and 120)
);

create unique index sheet_name_map_key_idx on public.sheet_name_map (sheet_key);

comment on table public.sheet_name_map is
  'Admin-edited sheet name to member link. Used on the next sync and on Rematch. Players cannot read it.';

create table public.member_dues_memo (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  memo_token text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  constraint member_dues_memo_token check (memo_token ~ '^[A-Z0-9]{1,24}$')
);

comment on table public.member_dues_memo is
  'Optional name token inside the Zelle memo, between CHW26 and the reminder date. A member reads their own row. Admins write it.';

create table public.sheet_dues_accounts (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null,
  sheet_name text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  club_status text,
  club_fee_cents integer not null,
  club_fee_status text,
  umpiring_fee_cents integer not null,
  umpiring_status text,
  received_saro_cents integer not null,
  received_ben_cents integer not null,
  received_total_cents integer not null,
  game_charges_total_cents integer,
  balance_due_cents integer not null,
  payment_notes text,
  constraint sheet_dues_accounts_key_shape check (
    char_length(sheet_key) between 1 and 120
    and sheet_key = lower(btrim(sheet_key))
  ),
  constraint sheet_dues_accounts_name_length check (char_length(btrim(sheet_name)) between 1 and 120),
  constraint sheet_dues_accounts_text_length check (
    (club_status is null or char_length(club_status) between 1 and 80)
    and (club_fee_status is null or char_length(club_fee_status) between 1 and 40)
    and (umpiring_status is null or char_length(umpiring_status) between 1 and 40)
    and (payment_notes is null or char_length(payment_notes) between 1 and 500)
  ),
  constraint sheet_dues_accounts_cents check (
    club_fee_cents between -100000000 and 100000000
    and umpiring_fee_cents between -100000000 and 100000000
    and received_saro_cents between -100000000 and 100000000
    and received_ben_cents between -100000000 and 100000000
    and received_total_cents between -100000000 and 100000000
    and balance_due_cents between -100000000 and 100000000
    and (
      game_charges_total_cents is null
      or game_charges_total_cents between -100000000 and 100000000
    )
  )
);

create unique index sheet_dues_accounts_key_idx on public.sheet_dues_accounts (sheet_key);
create index sheet_dues_accounts_profile_idx on public.sheet_dues_accounts (profile_id);

comment on table public.sheet_dues_accounts is
  'One row per name on the winter dues tab, plus a shell row for a splits-only name. balance_due_cents matches column M when the sheet has it: negative means the player owes the club.';

comment on column public.sheet_dues_accounts.balance_due_cents is
  'Sheet column M, in cents. Negative means owed. Positive means a credit.';

create table public.sheet_dues_charges (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null,
  sheet_name text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  sheet_row integer not null,
  charge_date date,
  charge_type text not null,
  game_label text,
  charge_kind text not null,
  team text,
  ground text,
  amount_cents integer not null,
  recon_status text,
  constraint sheet_dues_charges_key_shape check (
    char_length(sheet_key) between 1 and 120
    and sheet_key = lower(btrim(sheet_key))
  ),
  constraint sheet_dues_charges_name_length check (char_length(btrim(sheet_name)) between 1 and 120),
  constraint sheet_dues_charges_row check (sheet_row > 0 and sheet_row <> 510),
  constraint sheet_dues_charges_kind check (charge_kind in ('dues', 'water', 'umpire', 'other')),
  constraint sheet_dues_charges_text_length check (
    char_length(charge_type) between 1 and 160
    and (game_label is null or char_length(game_label) between 1 and 40)
    and (team is null or char_length(team) between 1 and 80)
    and (ground is null or char_length(ground) between 1 and 160)
    and (recon_status is null or char_length(recon_status) between 1 and 40)
  ),
  constraint sheet_dues_charges_amount check (amount_cents > 0 and amount_cents <= 100000000)
);

create index sheet_dues_charges_profile_idx on public.sheet_dues_charges (profile_id);
create index sheet_dues_charges_key_idx on public.sheet_dues_charges (sheet_key);

comment on table public.sheet_dues_charges is
  'One positive per-player amount from the winter splits tab. Row 510 is the helper row and is never stored. Players read their own rows.';

create or replace function private.stamp_finance_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'authenticated' then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;
  new.updated_at := now();
  if tg_table_name = 'finance_dues_settings' then
    new.updated_by := auth.uid();
    new.id := old.id;
  elsif tg_table_name = 'sheet_name_map' then
    if tg_op = 'INSERT' then
      new.created_by := auth.uid();
    else
      new.created_by := old.created_by;
      new.id := old.id;
      new.sheet_key := old.sheet_key;
    end if;
  elsif tg_table_name = 'member_dues_memo' then
    new.updated_by := auth.uid();
    if tg_op = 'UPDATE' then
      new.profile_id := old.profile_id;
    end if;
  end if;
  return new;
end;
$$;

comment on function private.stamp_finance_admin() is
  'Stamps admin edits to dues settings, name links, and memo tokens. A non-admin update fails even if a policy is widened later.';

revoke all on function private.stamp_finance_admin() from public;
revoke all on function private.stamp_finance_admin() from anon;
grant execute on function private.stamp_finance_admin() to authenticated;
grant execute on function private.stamp_finance_admin() to service_role;

create trigger finance_dues_settings_stamp
  before update on public.finance_dues_settings
  for each row execute function private.stamp_finance_admin();

create trigger sheet_name_map_stamp
  before insert or update on public.sheet_name_map
  for each row execute function private.stamp_finance_admin();

create trigger member_dues_memo_stamp
  before insert or update on public.member_dues_memo
  for each row execute function private.stamp_finance_admin();

create or replace function private.finance_sheet_target()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'finance_sheet_url'
  limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'finance_sheet_secret'
  limit 1;
  return jsonb_build_object(
    'url', nullif(btrim(coalesce(v_url, '')), ''),
    'secret', nullif(btrim(coalesce(v_secret, '')), '')
  );
end;
$$;

revoke all on function private.finance_sheet_target() from public;
revoke all on function private.finance_sheet_target() from anon;
revoke all on function private.finance_sheet_target() from authenticated;
grant execute on function private.finance_sheet_target() to service_role;

create or replace function public.finance_sheet_target()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.finance_sheet_target();
$$;

comment on function public.finance_sheet_target() is
  'Service role only. Apps Script URL and shared secret from Vault. Authenticated and anon cannot execute it.';

revoke all on function public.finance_sheet_target() from public;
revoke all on function public.finance_sheet_target() from anon;
revoke all on function public.finance_sheet_target() from authenticated;
grant execute on function public.finance_sheet_target() to service_role;

create or replace function private.replace_finance_sheet(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_synced timestamptz;
  v_source text;
  v_error text;
  v_accounts integer;
  v_charges integer;
  v_unmatched jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'snapshot payload required' using errcode = '22023';
  end if;
  if octet_length(payload::text) > 2000000 then
    raise exception 'snapshot is too large' using errcode = '22023';
  end if;

  if payload->>'mode' = 'error' then
    v_error := left(btrim(coalesce(payload->>'sync_error', '')), 500);
    if char_length(v_error) < 1 then
      v_error := 'The sheet could not be read.';
    end if;
    update public.finance_sheet_status
      set sync_error = v_error,
          updated_at = now()
      where id = 1;
    update public.finance_sheet_meta
      set last_attempt_at = now(),
          last_attempt_failed = true
      where id = 1;
    return jsonb_build_object('ok', false);
  end if;

  if payload->>'mode' is distinct from 'replace' then
    raise exception 'unknown snapshot mode' using errcode = '22023';
  end if;
  if jsonb_typeof(payload->'accounts') is distinct from 'array'
    or jsonb_typeof(payload->'charges') is distinct from 'array'
    or jsonb_typeof(payload->'unmatched_names') is distinct from 'array'
  then
    raise exception 'snapshot lists must be arrays' using errcode = '22023';
  end if;

  v_accounts := jsonb_array_length(payload->'accounts');
  v_charges := jsonb_array_length(payload->'charges');
  if v_accounts > 300 or v_charges > 8000 then
    raise exception 'snapshot list is over the club limit' using errcode = '22023';
  end if;

  v_synced := (payload->>'synced_at')::timestamptz;
  if v_synced is null then
    raise exception 'synced_at required' using errcode = '22023';
  end if;
  v_source := nullif(btrim(coalesce(payload->>'sync_source', '')), '');
  if v_source is null or v_source not in ('scheduled', 'manual') then
    raise exception 'sync_source must be scheduled or manual' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
    into v_unmatched
  from (
    select left(btrim(value), 120) as name
    from jsonb_array_elements_text(payload->'unmatched_names') as value
    where btrim(value) <> ''
    limit 80
  ) as names;

  perform 1 from public.finance_sheet_meta where id = 1 for update;

  delete from public.sheet_dues_charges where true;
  delete from public.sheet_dues_accounts where true;

  insert into public.sheet_dues_accounts (
    sheet_key,
    sheet_name,
    profile_id,
    club_status,
    club_fee_cents,
    club_fee_status,
    umpiring_fee_cents,
    umpiring_status,
    received_saro_cents,
    received_ben_cents,
    received_total_cents,
    game_charges_total_cents,
    balance_due_cents,
    payment_notes
  )
  select
    btrim(item->>'sheet_key'),
    btrim(item->>'sheet_name'),
    nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid,
    nullif(btrim(coalesce(item->>'club_status', '')), ''),
    (item->>'club_fee_cents')::integer,
    nullif(btrim(coalesce(item->>'club_fee_status', '')), ''),
    (item->>'umpiring_fee_cents')::integer,
    nullif(btrim(coalesce(item->>'umpiring_status', '')), ''),
    (item->>'received_saro_cents')::integer,
    (item->>'received_ben_cents')::integer,
    (item->>'received_total_cents')::integer,
    nullif(btrim(coalesce(item->>'game_charges_total_cents', '')), '')::integer,
    (item->>'balance_due_cents')::integer,
    nullif(btrim(coalesce(item->>'payment_notes', '')), '')
  from jsonb_array_elements(payload->'accounts') as item;

  insert into public.sheet_dues_charges (
    sheet_key,
    sheet_name,
    profile_id,
    sheet_row,
    charge_date,
    charge_type,
    game_label,
    charge_kind,
    team,
    ground,
    amount_cents,
    recon_status
  )
  select
    btrim(item->>'sheet_key'),
    btrim(item->>'sheet_name'),
    nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid,
    (item->>'sheet_row')::integer,
    nullif(btrim(coalesce(item->>'charge_date', '')), '')::date,
    btrim(item->>'charge_type'),
    nullif(btrim(coalesce(item->>'game_label', '')), ''),
    btrim(item->>'charge_kind'),
    nullif(btrim(coalesce(item->>'team', '')), ''),
    nullif(btrim(coalesce(item->>'ground', '')), ''),
    (item->>'amount_cents')::integer,
    nullif(btrim(coalesce(item->>'recon_status', '')), '')
  from jsonb_array_elements(payload->'charges') as item;

  update public.finance_sheet_meta
    set synced_at = v_synced,
        sync_source = v_source,
        last_attempt_at = v_synced,
        last_attempt_failed = false
    where id = 1;

  update public.finance_sheet_status
    set sync_error = null,
        unmatched_names = v_unmatched,
        account_count = v_accounts,
        charge_count = v_charges,
        updated_at = v_synced
    where id = 1;

  return jsonb_build_object(
    'ok', true,
    'accounts', v_accounts,
    'charges', v_charges,
    'unmatched', jsonb_array_length(v_unmatched),
    'synced_at', v_synced,
    'sync_source', v_source
  );
end;
$$;

revoke all on function private.replace_finance_sheet(jsonb) from public;
revoke all on function private.replace_finance_sheet(jsonb) from anon;
revoke all on function private.replace_finance_sheet(jsonb) from authenticated;
grant execute on function private.replace_finance_sheet(jsonb) to service_role;

create or replace function public.replace_finance_sheet(payload jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.replace_finance_sheet(payload);
$$;

comment on function public.replace_finance_sheet(jsonb) is
  'Service role only. Replaces the winter sheet copy or records a sync error. Authenticated and anon cannot execute it.';

revoke all on function public.replace_finance_sheet(jsonb) from public;
revoke all on function public.replace_finance_sheet(jsonb) from anon;
revoke all on function public.replace_finance_sheet(jsonb) from authenticated;
grant execute on function public.replace_finance_sheet(jsonb) to service_role;

create or replace function private.relink_finance_sheet(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unmatched jsonb;
  v_accounts integer := 0;
  v_charges integer := 0;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'relink payload required' using errcode = '22023';
  end if;
  if jsonb_typeof(payload->'accounts') is distinct from 'array'
    or jsonb_typeof(payload->'charges') is distinct from 'array'
    or jsonb_typeof(payload->'unmatched_names') is distinct from 'array'
  then
    raise exception 'relink lists must be arrays' using errcode = '22023';
  end if;
  if jsonb_array_length(payload->'accounts') > 300
    or jsonb_array_length(payload->'charges') > 8000
  then
    raise exception 'relink list is over the club limit' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(name order by name), '[]'::jsonb)
    into v_unmatched
  from (
    select left(btrim(value), 120) as name
    from jsonb_array_elements_text(payload->'unmatched_names') as value
    where btrim(value) <> ''
    limit 80
  ) as names;

  update public.sheet_dues_accounts as account
    set profile_id = nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid
  from jsonb_array_elements(payload->'accounts') as item
  where account.sheet_key = btrim(item->>'sheet_key');
  get diagnostics v_accounts = row_count;

  update public.sheet_dues_charges as charge
    set profile_id = nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid
  from jsonb_array_elements(payload->'charges') as item
  where charge.sheet_key = btrim(item->>'sheet_key');
  get diagnostics v_charges = row_count;

  update public.finance_sheet_status
    set unmatched_names = v_unmatched,
        updated_at = now()
    where id = 1;

  return jsonb_build_object(
    'ok', true,
    'accounts', v_accounts,
    'charges', v_charges,
    'unmatched', jsonb_array_length(v_unmatched)
  );
end;
$$;

revoke all on function private.relink_finance_sheet(jsonb) from public;
revoke all on function private.relink_finance_sheet(jsonb) from anon;
revoke all on function private.relink_finance_sheet(jsonb) from authenticated;
grant execute on function private.relink_finance_sheet(jsonb) to service_role;

create or replace function public.relink_finance_sheet(payload jsonb)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.relink_finance_sheet(payload);
$$;

comment on function public.relink_finance_sheet(jsonb) is
  'Service role only. Points stored sheet rows at members again after an admin edits the name map. Does not read the sheet.';

revoke all on function public.relink_finance_sheet(jsonb) from public;
revoke all on function public.relink_finance_sheet(jsonb) from anon;
revoke all on function public.relink_finance_sheet(jsonb) from authenticated;
grant execute on function public.relink_finance_sheet(jsonb) to service_role;

alter table public.finance_dues_settings enable row level security;
alter table public.finance_sheet_meta enable row level security;
alter table public.finance_sheet_status enable row level security;
alter table public.sheet_name_map enable row level security;
alter table public.member_dues_memo enable row level security;
alter table public.sheet_dues_accounts enable row level security;
alter table public.sheet_dues_charges enable row level security;

alter table public.finance_dues_settings force row level security;
alter table public.finance_sheet_meta force row level security;
alter table public.finance_sheet_status force row level security;
alter table public.sheet_name_map force row level security;
alter table public.member_dues_memo force row level security;
alter table public.sheet_dues_accounts force row level security;
alter table public.sheet_dues_charges force row level security;

revoke all on table public.finance_dues_settings from public, anon, authenticated;
grant select, update on table public.finance_dues_settings to authenticated;
grant select, insert, update, delete on table public.finance_dues_settings to service_role;

revoke all on table public.finance_sheet_meta from public, anon, authenticated;
grant select on table public.finance_sheet_meta to authenticated;
grant select, insert, update, delete on table public.finance_sheet_meta to service_role;

revoke all on table public.finance_sheet_status from public, anon, authenticated;
grant select on table public.finance_sheet_status to authenticated;
grant select, insert, update, delete on table public.finance_sheet_status to service_role;

revoke all on table public.sheet_name_map from public, anon, authenticated;
grant select, insert, update, delete on table public.sheet_name_map to authenticated;
grant select, insert, update, delete on table public.sheet_name_map to service_role;

revoke all on table public.member_dues_memo from public, anon, authenticated;
grant select, insert, update, delete on table public.member_dues_memo to authenticated;
grant select, insert, update, delete on table public.member_dues_memo to service_role;

revoke all on table public.sheet_dues_accounts from public, anon, authenticated;
grant select on table public.sheet_dues_accounts to authenticated;
grant select, insert, update, delete on table public.sheet_dues_accounts to service_role;

revoke all on table public.sheet_dues_charges from public, anon, authenticated;
grant select on table public.sheet_dues_charges to authenticated;
grant select, insert, update, delete on table public.sheet_dues_charges to service_role;

create policy finance_dues_settings_select_member on public.finance_dues_settings
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy finance_dues_settings_select_member on public.finance_dues_settings is
  'Any signed-in member can read the Zelle address and the reminder date. The memo is built from those plus their name.';

create policy finance_dues_settings_update_admin on public.finance_dues_settings
  for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

comment on policy finance_dues_settings_update_admin on public.finance_dues_settings is
  'Admins change the Zelle address and the MMDD in the memo. There is no insert policy; the migration seeds the one row.';

create policy finance_sheet_meta_select_member on public.finance_sheet_meta
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy finance_sheet_meta_select_member on public.finance_sheet_meta is
  'Any signed-in member can read when the sheet was last copied.';

create policy finance_sheet_status_select_staff on public.finance_sheet_status
  for select to authenticated
  using ((select private.is_staff()));

comment on policy finance_sheet_status_select_staff on public.finance_sheet_status is
  'Sync errors and unmatched sheet names are admin and captain only.';

create policy sheet_name_map_select_staff on public.sheet_name_map
  for select to authenticated
  using ((select private.is_staff()));

create policy sheet_name_map_insert_admin on public.sheet_name_map
  for insert to authenticated
  with check ((select private.current_role()) = 'admin');

create policy sheet_name_map_update_admin on public.sheet_name_map
  for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy sheet_name_map_delete_admin on public.sheet_name_map
  for delete to authenticated
  using ((select private.current_role()) = 'admin');

comment on policy sheet_name_map_select_staff on public.sheet_name_map is
  'Captains and admins can see which sheet names are linked. Only an admin can change them.';

create policy member_dues_memo_select_own_or_staff on public.member_dues_memo
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

create policy member_dues_memo_insert_admin on public.member_dues_memo
  for insert to authenticated
  with check ((select private.current_role()) = 'admin');

create policy member_dues_memo_update_admin on public.member_dues_memo
  for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy member_dues_memo_delete_admin on public.member_dues_memo
  for delete to authenticated
  using ((select private.current_role()) = 'admin');

comment on policy member_dues_memo_select_own_or_staff on public.member_dues_memo is
  'A member reads the memo token on their own dues. Captains and admins read every token. Only an admin writes one.';

create policy sheet_dues_accounts_select_own_or_staff on public.sheet_dues_accounts
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy sheet_dues_accounts_select_own_or_staff on public.sheet_dues_accounts is
  'A member reads the winter dues row linked to them. Captains and admins read every row, including names with no member yet.';

create policy sheet_dues_charges_select_own_or_staff on public.sheet_dues_charges
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy sheet_dues_charges_select_own_or_staff on public.sheet_dues_charges is
  'A member reads their own game charges. Captains and admins read every charge.';

insert into public.finance_dues_settings (id, zelle_email, reminder_mmdd)
values (1, 'treasurercheetahscricket@gmail.com', '1114');

insert into public.finance_sheet_meta (id) values (1);
insert into public.finance_sheet_status (id) values (1);

select cron.schedule(
  'sync-finance-sheet-hourly',
  '40 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync-finance-sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-finance-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'finance_sheet_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

notify pgrst, 'reload schema';
