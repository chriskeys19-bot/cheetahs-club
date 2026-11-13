-- Copy public.feedback to the club Google Sheet without blocking the insert.
--
-- The browser still inserts into public.feedback and nowhere else. An after
-- insert trigger asks sync-feedback-sheet to append that row. The hourly job
-- sends rows that are still unsynced, which is also the one-time backfill.
-- Both calls use feedback_sheet_secret from Vault, not the service role key.
-- The Apps Script URL is feedback_sheet_url and is set after the script is
-- deployed. Until that URL exists, rows stay unsynced and the insert still
-- succeeds.
--
-- Sync state is in private.feedback_sheet_sync. Members cannot read or update
-- it, so they cannot mark a note synced or clear a failure. The service role
-- reaches it only through the functions below.

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

  if not exists (select 1 from vault.secrets where name = 'feedback_sheet_secret') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'feedback_sheet_secret',
      'Shared with the feedback Apps Script. Not the service role key.'
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
  where name = 'feedback_sheet_secret';
  if v_secret is null or length(v_secret) < 32 then
    raise exception 'feedback_sheet_secret is missing from Vault';
  end if;
end
$$;

create table private.feedback_sheet_sync (
  feedback_id uuid primary key references public.feedback (id) on delete cascade,
  synced_at timestamptz,
  last_error text,
  attempt_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint feedback_sheet_sync_error_length check (
    last_error is null or char_length(last_error) between 1 and 500
  ),
  constraint feedback_sheet_sync_attempt_count check (attempt_count >= 0)
);

comment on table private.feedback_sheet_sync is
  'Which feedback rows have been appended to the Google Sheet. Unsynced rows stay here with synced_at null, or have no row yet. Service role only, via the feedback_sheet functions.';

alter table private.feedback_sheet_sync enable row level security;

revoke all on table private.feedback_sheet_sync from public;
revoke all on table private.feedback_sheet_sync from anon;
revoke all on table private.feedback_sheet_sync from authenticated;
revoke all on table private.feedback_sheet_sync from service_role;

create or replace function private.feedback_sheet_target()
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
  where name = 'feedback_sheet_url'
  limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'feedback_sheet_secret'
  limit 1;
  return jsonb_build_object(
    'url', nullif(btrim(coalesce(v_url, '')), ''),
    'secret', nullif(btrim(coalesce(v_secret, '')), '')
  );
end;
$$;

revoke all on function private.feedback_sheet_target() from public;
revoke all on function private.feedback_sheet_target() from anon;
revoke all on function private.feedback_sheet_target() from authenticated;
grant execute on function private.feedback_sheet_target() to service_role;

create or replace function public.feedback_sheet_target()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.feedback_sheet_target();
$$;

comment on function public.feedback_sheet_target() is
  'Service role only. Apps Script URL and shared secret from Vault. Authenticated and anon cannot execute it.';

revoke all on function public.feedback_sheet_target() from public;
revoke all on function public.feedback_sheet_target() from anon;
revoke all on function public.feedback_sheet_target() from authenticated;
grant execute on function public.feedback_sheet_target() to service_role;

create or replace function private.feedback_sheet_pending(p_limit integer, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  v_limit := least(greatest(coalesce(p_limit, 25), 1), 50);
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', item.id,
        'created_at', item.created_at,
        'submitter_name', item.submitter_name,
        'submitter_email', item.submitter_email,
        'role', item.role,
        'body', item.body
      )
      order by item.created_at, item.id
    )
    from (
      select
        feedback.id,
        feedback.created_at,
        feedback.submitter_name,
        feedback.submitter_email,
        feedback.role,
        feedback.body
      from public.feedback as feedback
      left join private.feedback_sheet_sync as sync
        on sync.feedback_id = feedback.id
      where (sync.feedback_id is null or sync.synced_at is null)
        and (p_id is null or feedback.id = p_id)
      order by feedback.created_at, feedback.id
      limit v_limit
    ) as item
  ), '[]'::jsonb);
end;
$$;

revoke all on function private.feedback_sheet_pending(integer, uuid) from public;
revoke all on function private.feedback_sheet_pending(integer, uuid) from anon;
revoke all on function private.feedback_sheet_pending(integer, uuid) from authenticated;
grant execute on function private.feedback_sheet_pending(integer, uuid) to service_role;

create or replace function public.feedback_sheet_pending(p_limit integer default 25, p_id uuid default null)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select private.feedback_sheet_pending(p_limit, p_id);
$$;

comment on function public.feedback_sheet_pending(integer, uuid) is
  'Service role only. Feedback rows that are not on the sheet yet, oldest first.';

revoke all on function public.feedback_sheet_pending(integer, uuid) from public;
revoke all on function public.feedback_sheet_pending(integer, uuid) from anon;
revoke all on function public.feedback_sheet_pending(integer, uuid) from authenticated;
grant execute on function public.feedback_sheet_pending(integer, uuid) to service_role;

create or replace function private.feedback_sheet_result(p_id uuid, p_ok boolean, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_error text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_id is null then
    raise exception 'feedback id required' using errcode = '22023';
  end if;
  if p_ok is null then
    raise exception 'p_ok required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.feedback where id = p_id) then
    raise exception 'feedback row not found' using errcode = 'P0002';
  end if;

  v_error := left(btrim(coalesce(p_error, '')), 500);
  if p_ok then
    v_error := null;
  elsif v_error = '' then
    v_error := 'The sheet write failed.';
  end if;

  insert into private.feedback_sheet_sync as sync (
    feedback_id,
    synced_at,
    last_error,
    attempt_count,
    updated_at
  )
  values (p_id, case when p_ok then now() else null end, v_error, 1, now())
  on conflict (feedback_id) do update
    set synced_at = case when p_ok then now() else sync.synced_at end,
        last_error = case when p_ok then null else v_error end,
        attempt_count = sync.attempt_count + 1,
        updated_at = now()
    where sync.synced_at is null or p_ok;
end;
$$;

revoke all on function private.feedback_sheet_result(uuid, boolean, text) from public;
revoke all on function private.feedback_sheet_result(uuid, boolean, text) from anon;
revoke all on function private.feedback_sheet_result(uuid, boolean, text) from authenticated;
grant execute on function private.feedback_sheet_result(uuid, boolean, text) to service_role;

create or replace function public.feedback_sheet_result(p_id uuid, p_ok boolean, p_error text default null)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform private.feedback_sheet_result(p_id, p_ok, p_error);
end;
$$;

comment on function public.feedback_sheet_result(uuid, boolean, text) is
  'Service role only. Marks a feedback row synced, or records why the sheet write failed. A later failure does not clear an earlier success.';

revoke all on function public.feedback_sheet_result(uuid, boolean, text) from public;
revoke all on function public.feedback_sheet_result(uuid, boolean, text) from anon;
revoke all on function public.feedback_sheet_result(uuid, boolean, text) from authenticated;
grant execute on function public.feedback_sheet_result(uuid, boolean, text) to service_role;

create or replace function private.queue_feedback_sheet_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'project_url'
  limit 1;
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'feedback_sheet_secret'
  limit 1;
  if v_url is null or v_secret is null or length(btrim(v_secret)) < 16 then
    return new;
  end if;

  begin
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/sync-feedback-sheet',
      body := jsonb_build_object('feedback_id', new.id),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-feedback-sync', btrim(v_secret)
      ),
      timeout_milliseconds := 30000
    );
  exception
    when others then
      raise warning 'feedback sheet queue failed';
      return new;
  end;
  return new;
end;
$$;

comment on function private.queue_feedback_sheet_sync() is
  'After insert, asks sync-feedback-sheet to append the new row. A network or Vault problem does not roll back the feedback insert.';

revoke all on function private.queue_feedback_sheet_sync() from public;
revoke all on function private.queue_feedback_sheet_sync() from anon;
grant execute on function private.queue_feedback_sheet_sync() to authenticated;
grant execute on function private.queue_feedback_sheet_sync() to service_role;

create trigger feedback_queue_sheet_sync
  after insert on public.feedback
  for each row
  execute function private.queue_feedback_sheet_sync();

select cron.schedule(
  'sync-feedback-sheet-hourly',
  '20 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
      || '/functions/v1/sync-feedback-sheet',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-feedback-sync', (select decrypted_secret from vault.decrypted_secrets where name = 'feedback_sheet_secret')
    ),
    body := '{"backfill":true}'::jsonb,
    timeout_milliseconds := 55000
  );
  $job$
);

notify pgrst, 'reload schema';
