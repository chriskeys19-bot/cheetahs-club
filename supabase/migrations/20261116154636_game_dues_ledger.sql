-- Game Dues Ledger rows copied from Cheetah CC Finance_2026, plus the
-- automatic credit (Club Dues column O) and the manual credit (column P).
--
-- sync-finance-sheet replaces public.sheet_ledger_rows on each successful
-- read that includes the ledger grid. A payload without a ledger array
-- (the Apps Script before it is redeployed) leaves the rows untouched and
-- still replaces dues and charges. Players read their own rows. Captains
-- and admins (private.is_staff) read every row. There is no write policy.

alter table public.sheet_dues_accounts
  add column sheet_credit_cents integer not null default 0,
  add column manual_credit_cents integer not null default 0;

alter table public.sheet_dues_accounts
  drop constraint sheet_dues_accounts_cents;

alter table public.sheet_dues_accounts
  add constraint sheet_dues_accounts_cents check (
    club_fee_cents between -100000000 and 100000000
    and umpiring_fee_cents between -100000000 and 100000000
    and received_saro_cents between -100000000 and 100000000
    and received_ben_cents between -100000000 and 100000000
    and received_total_cents between -100000000 and 100000000
    and balance_due_cents between -100000000 and 100000000
    and sheet_credit_cents between -100000000 and 100000000
    and manual_credit_cents between -100000000 and 100000000
    and (
      game_charges_total_cents is null
      or game_charges_total_cents between -100000000 and 100000000
    )
  );

comment on column public.sheet_dues_accounts.sheet_credit_cents is
  'Club Dues column O, in cents. Automatic credit. This can be positive while balance due is negative.';

comment on column public.sheet_dues_accounts.manual_credit_cents is
  'Club Dues column P, in cents. Manual credit, added to column O on My dues.';

create table public.sheet_ledger_rows (
  id uuid primary key default gen_random_uuid(),
  sheet_key text not null,
  sheet_name text not null,
  profile_id uuid references public.profiles (id) on delete set null,
  sheet_row integer not null,
  game_date date,
  team text,
  game_no integer,
  ground text,
  dues_cents integer not null,
  paid_cents integer not null,
  unsettled_cents integer not null,
  status text not null,
  memo text,
  source text,
  synced_at timestamptz not null,
  constraint sheet_ledger_rows_key_shape check (
    char_length(sheet_key) between 1 and 120
    and sheet_key = lower(btrim(sheet_key))
  ),
  constraint sheet_ledger_rows_name_length check (char_length(btrim(sheet_name)) between 1 and 120),
  constraint sheet_ledger_rows_row check (sheet_row >= 4),
  constraint sheet_ledger_rows_game check (game_no is null or (game_no >= 0 and game_no <= 10000)),
  constraint sheet_ledger_rows_status check (status in ('Paid', 'Partial', 'Open')),
  constraint sheet_ledger_rows_text_length check (
    (team is null or char_length(team) between 1 and 80)
    and (ground is null or char_length(ground) between 1 and 160)
    and (memo is null or char_length(memo) between 1 and 500)
    and (source is null or char_length(source) between 1 and 120)
  ),
  constraint sheet_ledger_rows_cents check (
    dues_cents between 0 and 100000000
    and paid_cents between 0 and 100000000
    and unsettled_cents between 0 and 100000000
  )
);

create unique index sheet_ledger_rows_row_idx on public.sheet_ledger_rows (sheet_row);
create index sheet_ledger_rows_profile_idx on public.sheet_ledger_rows (profile_id);
create index sheet_ledger_rows_key_idx on public.sheet_ledger_rows (sheet_key);

comment on table public.sheet_ledger_rows is
  'One Game Dues Ledger row per sheet row, replaced on each sync that returns the ledger. paid_cents and unsettled_cents are the sheet allocation. Players read their own rows.';

comment on column public.sheet_ledger_rows.paid_cents is
  'Allocated paid, from the ledger. My dues does not recompute this.';

comment on column public.sheet_ledger_rows.unsettled_cents is
  'Unsettled amount, from the ledger. Zero means the row is paid.';

comment on column public.sheet_ledger_rows.memo is
  'Ledger memo, copied as written. Blank cells are stored as null.';

comment on column public.sheet_ledger_rows.source is
  'Sheet source note, for example GC Splits!N9.';

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
  v_ledger integer := null;
  v_unmatched jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'snapshot payload required' using errcode = '22023';
  end if;
  if octet_length(payload::text) > 4000000 then
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
  if payload ? 'ledger'
    and jsonb_typeof(payload->'ledger') is distinct from 'array'
    and payload->'ledger' is not null
  then
    raise exception 'ledger must be an array' using errcode = '22023';
  end if;

  v_accounts := jsonb_array_length(payload->'accounts');
  v_charges := jsonb_array_length(payload->'charges');
  if v_accounts > 300 or v_charges > 8000 then
    raise exception 'snapshot list is over the club limit' using errcode = '22023';
  end if;
  if payload ? 'ledger' and jsonb_typeof(payload->'ledger') = 'array' then
    v_ledger := jsonb_array_length(payload->'ledger');
    if v_ledger > 2500 then
      raise exception 'snapshot list is over the club limit' using errcode = '22023';
    end if;
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
    payment_notes,
    sheet_credit_cents,
    manual_credit_cents
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
    nullif(btrim(coalesce(item->>'payment_notes', '')), ''),
    coalesce(nullif(btrim(coalesce(item->>'sheet_credit_cents', '')), '')::integer, 0),
    coalesce(nullif(btrim(coalesce(item->>'manual_credit_cents', '')), '')::integer, 0)
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

  if v_ledger is not null then
    delete from public.sheet_ledger_rows where true;

    insert into public.sheet_ledger_rows (
      sheet_key,
      sheet_name,
      profile_id,
      sheet_row,
      game_date,
      team,
      game_no,
      ground,
      dues_cents,
      paid_cents,
      unsettled_cents,
      status,
      memo,
      source,
      synced_at
    )
    select distinct on (sheet_row)
      btrim(item->>'sheet_key'),
      left(btrim(item->>'sheet_name'), 120),
      nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid,
      sheet_row,
      nullif(btrim(coalesce(item->>'game_date', '')), '')::date,
      nullif(left(btrim(coalesce(item->>'team', '')), 80), ''),
      nullif(btrim(coalesce(item->>'game_no', '')), '')::integer,
      nullif(left(btrim(coalesce(item->>'ground', '')), 160), ''),
      coalesce((item->>'dues_cents')::integer, 0),
      coalesce((item->>'paid_cents')::integer, 0),
      coalesce((item->>'unsettled_cents')::integer, 0),
      case lower(btrim(coalesce(item->>'status', '')))
        when 'paid' then 'Paid'
        when 'partial' then 'Partial'
        when 'open' then 'Open'
        else 'Open'
      end,
      nullif(left(btrim(coalesce(item->>'memo', '')), 500), ''),
      nullif(left(btrim(coalesce(item->>'source', '')), 120), ''),
      v_synced
    from jsonb_array_elements(payload->'ledger') as item
    cross join lateral (select (item->>'sheet_row')::integer as sheet_row) as parsed
    order by sheet_row;
  end if;

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
    'ledger', v_ledger,
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
  'Service role only. Replaces the winter sheet copy, and the game dues ledger when the payload includes one. Records a sync error without clearing rows. Authenticated and anon cannot execute it.';

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
  v_ledger integer := 0;
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
  if payload ? 'ledger'
    and jsonb_typeof(payload->'ledger') is distinct from 'array'
    and payload->'ledger' is not null
  then
    raise exception 'ledger must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(payload->'accounts') > 300
    or jsonb_array_length(payload->'charges') > 8000
    or (
      payload ? 'ledger'
      and jsonb_typeof(payload->'ledger') = 'array'
      and jsonb_array_length(payload->'ledger') > 2500
    )
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

  if payload ? 'ledger' and jsonb_typeof(payload->'ledger') = 'array' then
    update public.sheet_ledger_rows as ledger_row
      set profile_id = nullif(btrim(coalesce(item->>'profile_id', '')), '')::uuid
    from jsonb_array_elements(payload->'ledger') as item
    where ledger_row.sheet_key = btrim(item->>'sheet_key');
    get diagnostics v_ledger = row_count;
  end if;

  update public.finance_sheet_status
    set unmatched_names = v_unmatched,
        updated_at = now()
    where id = 1;

  return jsonb_build_object(
    'ok', true,
    'accounts', v_accounts,
    'charges', v_charges,
    'ledger', v_ledger,
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
  'Service role only. Points stored sheet rows, including game dues ledger rows when they are in the payload, at members again after an admin edits the name map. Does not read the sheet.';

revoke all on function public.relink_finance_sheet(jsonb) from public;
revoke all on function public.relink_finance_sheet(jsonb) from anon;
revoke all on function public.relink_finance_sheet(jsonb) from authenticated;
grant execute on function public.relink_finance_sheet(jsonb) to service_role;

alter table public.sheet_ledger_rows enable row level security;
alter table public.sheet_ledger_rows force row level security;

revoke all on table public.sheet_ledger_rows from public, anon, authenticated;
grant select on table public.sheet_ledger_rows to authenticated;
grant select, insert, update, delete on table public.sheet_ledger_rows to service_role;

create policy sheet_ledger_rows_select_own_or_staff on public.sheet_ledger_rows
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy sheet_ledger_rows_select_own_or_staff on public.sheet_ledger_rows is
  'A member reads game dues ledger rows linked to them. Captains and admins read every row, including names with no member yet.';
