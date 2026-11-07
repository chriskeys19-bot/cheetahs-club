-- Live streams for Cheetahs league games.
--
-- game_streams is one row per schedule event. stream_jobs is the queue the
-- request-stream-job Edge Function fills. A Grok Bot outside this app does the
-- YouTube, CricClubs, and overlay work and writes results with the service role.
-- Key values are never stored. stream_keys holds display names only.
--
-- Authenticated members can read streams and queue a job only through
-- public.request_stream_job, which checks the action against the current row.
-- Players cannot update status or result columns. Staff can edit the display
-- fields. Admins can edit every column. The service role writes processor results.
--
-- schedule_events.video_url, schedule_events_video_url_check, and
-- private.stamp_schedule_event already exist (20261107120000_game_video_url.sql).
-- This migration does not add or replace them. stamp_schedule_event rejects a
-- video_url change only when auth.uid() is set and the member is not staff.
-- A service-role write has auth.uid() null, so that check does not run.

create or replace function private.is_cricclubs_url(p_url text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    char_length(btrim(p_url)) between 16 and 500
    and btrim(p_url) ~* '^https?://([a-z0-9-]+\.)*cricclubs\.com(:[0-9]+)?([/?#][^[:space:]]*)?$',
    false
  );
$$;

revoke all on function private.is_cricclubs_url(text) from public;
revoke all on function private.is_cricclubs_url(text) from anon;
revoke all on function private.is_cricclubs_url(text) from authenticated;

create table public.stream_keys (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stream_keys_name_length check (char_length(btrim(name)) between 1 and 80),
  constraint stream_keys_sort_order check (sort_order between 0 and 1000)
);

comment on table public.stream_keys is
  'Display names for the club streaming devices. The key value is never stored.';

create unique index stream_keys_name_lower_idx
  on public.stream_keys (lower(btrim(name)));

create index stream_keys_sort_idx
  on public.stream_keys (active, sort_order, name);

insert into public.stream_keys (name, sort_order)
select 'Yolobox Pro 1', 1
where not exists (
  select 1 from public.stream_keys where lower(btrim(name)) = lower('Yolobox Pro 1')
);

insert into public.stream_keys (name, sort_order)
select 'Yolobox Pro 2', 2
where not exists (
  select 1 from public.stream_keys where lower(btrim(name)) = lower('Yolobox Pro 2')
);

create table public.game_streams (
  id uuid primary key default gen_random_uuid(),
  schedule_event_id uuid not null unique references public.schedule_events (id) on delete cascade,
  status text not null default 'none',
  stream_key_name text,
  youtube_video_id text,
  youtube_url text,
  scorecard_url text,
  overlay_url text,
  overlay_short_url text,
  whatsapp_message text,
  last_error text,
  requested_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint game_streams_status_check check (
    status in (
      'none',
      'creating',
      'awaiting_scorecard',
      'setting_up_overlay',
      'ready',
      'ending',
      'ended',
      'failed'
    )
  ),
  constraint game_streams_key_name_length check (
    stream_key_name is null or char_length(btrim(stream_key_name)) between 1 and 80
  ),
  constraint game_streams_youtube_id_length check (
    youtube_video_id is null or char_length(btrim(youtube_video_id)) between 1 and 64
  ),
  constraint game_streams_youtube_url_check check (
    youtube_url is null
    or (
      char_length(btrim(youtube_url)) between 12 and 500
      and btrim(youtube_url) ~* '^https://[^[:space:]]+$'
    )
  ),
  constraint game_streams_scorecard_url_check check (
    scorecard_url is null or private.is_cricclubs_url(scorecard_url)
  ),
  constraint game_streams_overlay_url_check check (
    overlay_url is null
    or (
      char_length(btrim(overlay_url)) between 12 and 500
      and btrim(overlay_url) ~* '^https://[^[:space:]]+$'
    )
  ),
  constraint game_streams_overlay_short_url_check check (
    overlay_short_url is null
    or (
      char_length(btrim(overlay_short_url)) between 12 and 500
      and btrim(overlay_short_url) ~* '^https://[^[:space:]]+$'
    )
  ),
  constraint game_streams_whatsapp_length check (
    whatsapp_message is null or char_length(whatsapp_message) <= 2000
  ),
  constraint game_streams_error_length check (
    last_error is null or char_length(last_error) <= 500
  )
);

comment on table public.game_streams is
  'One live-stream record per Cheetahs league game. Realtime updates the schedule pop-up.';

comment on column public.game_streams.stream_key_name is
  'Name of the stream key that was chosen, such as Yolobox Pro 2. The key value is never stored.';

comment on column public.game_streams.status is
  'none, creating, awaiting_scorecard, setting_up_overlay, ready, ending, ended, or failed.';

create index game_streams_requested_by_idx
  on public.game_streams (requested_by);

create index game_streams_status_idx
  on public.game_streams (status);

create table public.stream_jobs (
  id uuid primary key default gen_random_uuid(),
  game_stream_id uuid not null references public.game_streams (id) on delete cascade,
  action text not null,
  status text not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  error text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stream_jobs_action_check check (action in ('create', 'add_scorecard', 'end')),
  constraint stream_jobs_status_check check (status in ('pending', 'running', 'done', 'failed')),
  constraint stream_jobs_error_length check (error is null or char_length(error) <= 500),
  constraint stream_jobs_payload_object check (jsonb_typeof(payload) = 'object'),
  constraint stream_jobs_payload_size check (char_length(payload::text) <= 2000)
);

comment on table public.stream_jobs is
  'Queue for create, add_scorecard, and end. The outside processor marks jobs running, done, or failed.';

create index stream_jobs_game_stream_idx
  on public.stream_jobs (game_stream_id, created_at desc);

create index stream_jobs_created_by_idx
  on public.stream_jobs (created_by);

create unique index stream_jobs_one_open_idx
  on public.stream_jobs (game_stream_id)
  where status in ('pending', 'running');

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function private.touch_updated_at() from public;
revoke all on function private.touch_updated_at() from anon;
revoke all on function private.touch_updated_at() from authenticated;

create trigger stream_keys_touch
  before update on public.stream_keys
  for each row execute function private.touch_updated_at();

create trigger stream_jobs_touch
  before update on public.stream_jobs
  for each row execute function private.touch_updated_at();

create or replace function private.guard_game_stream_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();

  -- The validating RPC runs as the table owner. The processor uses service_role.
  -- Both may change status and result columns. Signed-in members are authenticated.
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.id is distinct from old.id
    or new.schedule_event_id is distinct from old.schedule_event_id
    or new.requested_by is distinct from old.requested_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'That stream field cannot be edited.' using errcode = '42501';
  end if;

  if new.scorecard_url is distinct from old.scorecard_url then
    raise exception 'Update the scorecard from the stream pop-up so the overlay can refresh.'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status
    or new.youtube_video_id is distinct from old.youtube_video_id
    or new.last_error is distinct from old.last_error
  then
    if (select private.current_role()) is distinct from 'admin'
      and (select private.current_role()) is distinct from 'captain'
    then
      raise exception 'Players cannot update status or result fields.' using errcode = '42501';
    end if;
    if (select private.current_role()) is distinct from 'admin'
      and (
        new.youtube_video_id is distinct from old.youtube_video_id
        or new.last_error is distinct from old.last_error
      )
    then
      raise exception 'Results are written by the service role.' using errcode = '42501';
    end if;
  end if;

  if (select private.is_staff()) or old.requested_by = (select auth.uid()) then
    return new;
  end if;

  raise exception 'Only staff or the person who started this stream can edit it.' using errcode = '42501';
end;
$$;

revoke all on function private.guard_game_stream_update() from public;
revoke all on function private.guard_game_stream_update() from anon;
revoke all on function private.guard_game_stream_update() from authenticated;

create trigger game_streams_guard
  before update on public.game_streams
  for each row execute function private.guard_game_stream_update();

create or replace function private.copy_ended_stream_video()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
begin
  if new.status is distinct from 'ended' or new.youtube_url is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
    and old.status = 'ended'
    and old.youtube_url is not distinct from new.youtube_url
  then
    return new;
  end if;

  -- Same shape as schedule_events_video_url_check. A non-YouTube link is left
  -- for the processor to store itself, instead of failing this stream update.
  v_url := btrim(new.youtube_url);
  if char_length(v_url) < 17
    or char_length(v_url) > 500
    or v_url !~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/[^[:space:]]+$'
  then
    return new;
  end if;

  -- Runs in the processor's service-role transaction. auth.uid() is null there,
  -- so stamp_schedule_event allows the video_url write. An admin session is staff,
  -- so that path is allowed too. The column stays untouched when it already has a link.
  update public.schedule_events
    set video_url = v_url
    where id = new.schedule_event_id
      and video_url is null;
  return new;
end;
$$;

revoke all on function private.copy_ended_stream_video() from public;
revoke all on function private.copy_ended_stream_video() from anon;
revoke all on function private.copy_ended_stream_video() from authenticated;

create trigger game_streams_copy_video
  after insert or update of status, youtube_url on public.game_streams
  for each row execute function private.copy_ended_stream_video();

create or replace function private.request_stream_job(
  p_schedule_event_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_role text;
  v_slug text;
  v_event_type text;
  v_stream public.game_streams%rowtype;
  v_key text;
  v_scorecard text;
  v_next text;
  v_job_id uuid;
  v_clean jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;

  if p_action not in ('create', 'add_scorecard', 'end') then
    raise exception 'Choose a stream action.' using errcode = '22023';
  end if;

  if p_payload is null then
    p_payload := '{}'::jsonb;
  end if;

  if jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Send a stream payload object.' using errcode = '22023';
  end if;

  if p_payload ? 'stream_key'
    or p_payload ? 'key'
    or p_payload ? 'secret'
    or p_payload ? 'stream_key_value'
  then
    raise exception 'Stream key values are not stored.' using errcode = '22023';
  end if;

  if char_length(p_payload::text) > 2000 then
    raise exception 'That stream request is too large.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_schedule_event_id::text, 0));

  select event.event_type, team.slug
    into v_event_type, v_slug
  from public.schedule_events as event
  left join public.teams as team on team.id = event.team_id
  where event.id = p_schedule_event_id;

  if v_event_type is null then
    raise exception 'That game is not on the schedule.' using errcode = '22023';
  end if;

  if v_event_type <> 'league_game' or v_slug is null or v_slug not in ('alpha', 'beta', 'gamma') then
    raise exception 'Streams are only for Cheetahs league games.' using errcode = '22023';
  end if;

  select * into v_stream
  from public.game_streams
  where schedule_event_id = p_schedule_event_id
  for update;

  if not found then
    v_stream := null;
  end if;

  v_role := private.current_role();
  if v_role is null or v_role not in ('admin', 'captain', 'player') then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;

  if v_stream is not null and v_stream.status = 'ended' and v_role is distinct from 'admin' then
    raise exception 'Only an admin can change an ended stream.' using errcode = '42501';
  end if;

  if v_stream is not null and exists (
    select 1
    from public.stream_jobs as job
    where job.game_stream_id = v_stream.id
      and job.status in ('pending', 'running')
  ) then
    raise exception 'A stream job is already queued for this game.' using errcode = 'P0001';
  end if;

  if p_action = 'create' then
    if v_stream is not null and (
      v_stream.status not in ('none', 'failed')
      or v_stream.youtube_video_id is not null
      or v_stream.youtube_url is not null
    ) then
      raise exception 'A stream already exists for this game.' using errcode = '22023';
    end if;

    v_key := btrim(coalesce(p_payload ->> 'stream_key_name', ''));
    if char_length(v_key) < 1 or char_length(v_key) > 80 then
      raise exception 'Choose a stream key.' using errcode = '22023';
    end if;

    if not exists (
      select 1
      from public.stream_keys as stream_key
      where stream_key.active
        and stream_key.name = v_key
    ) then
      raise exception 'Choose a stream key from the list.' using errcode = '22023';
    end if;

    v_next := 'creating';
    v_clean := jsonb_build_object('stream_key_name', v_key);

    if v_stream.id is null then
      insert into public.game_streams (
        schedule_event_id,
        status,
        stream_key_name,
        requested_by,
        last_error
      )
      values (p_schedule_event_id, v_next, v_key, v_uid, null)
      returning * into v_stream;
    else
      update public.game_streams
        set status = v_next,
            stream_key_name = v_key,
            requested_by = coalesce(requested_by, v_uid),
            last_error = null
        where id = v_stream.id
        returning * into v_stream;
    end if;
  elsif p_action = 'add_scorecard' then
    if v_stream.id is null
      or v_stream.status in ('none', 'creating', 'ending')
      or (
        v_stream.youtube_url is null
        and v_stream.youtube_video_id is null
        and v_stream.status = 'failed'
      )
    then
      raise exception 'Create the stream before adding a scorecard.' using errcode = '22023';
    end if;

    v_scorecard := btrim(coalesce(p_payload ->> 'scorecard_url', ''));
    if not private.is_cricclubs_url(v_scorecard) then
      raise exception 'Enter a cricclubs.com scorecard link.' using errcode = '22023';
    end if;
    v_scorecard := regexp_replace(v_scorecard, '^http://', 'https://', 'i');
    v_next := 'setting_up_overlay';
    v_clean := jsonb_build_object('scorecard_url', v_scorecard);

    update public.game_streams
      set status = v_next,
          scorecard_url = v_scorecard,
          last_error = null
      where id = v_stream.id
      returning * into v_stream;
  else
    if v_stream.id is null or v_stream.status in ('none', 'creating') then
      raise exception 'No live stream set up for this game yet.' using errcode = '22023';
    end if;
    if v_stream.status = 'ended' then
      raise exception 'This stream has already ended.' using errcode = '22023';
    end if;
    if v_stream.status = 'failed'
      and v_stream.youtube_url is null
      and v_stream.youtube_video_id is null
    then
      raise exception 'No live stream set up for this game yet.' using errcode = '22023';
    end if;

    v_next := 'ending';
    v_clean := '{}'::jsonb;

    update public.game_streams
      set status = v_next,
          last_error = null
      where id = v_stream.id
      returning * into v_stream;
  end if;

  insert into public.stream_jobs (game_stream_id, action, status, payload, created_by)
  values (v_stream.id, p_action, 'pending', v_clean, v_uid)
  returning id into v_job_id;

  return jsonb_build_object(
    'job_id', v_job_id,
    'game_stream_id', v_stream.id,
    'status', v_stream.status,
    'job_status', 'pending'
  );
exception
  when unique_violation then
    raise exception 'A stream job is already queued for this game.' using errcode = 'P0001';
end;
$$;

revoke all on function private.request_stream_job(uuid, text, jsonb) from public;
revoke all on function private.request_stream_job(uuid, text, jsonb) from anon;
grant execute on function private.request_stream_job(uuid, text, jsonb) to authenticated;
grant execute on function private.request_stream_job(uuid, text, jsonb) to service_role;

create or replace function public.request_stream_job(
  p_schedule_event_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.request_stream_job(p_schedule_event_id, p_action, p_payload);
$$;

comment on function public.request_stream_job(uuid, text, jsonb) is
  'Queues one stream job after checking the game, the action, and any open job. Direct inserts are not granted.';

revoke all on function public.request_stream_job(uuid, text, jsonb) from public;
revoke all on function public.request_stream_job(uuid, text, jsonb) from anon;
grant execute on function public.request_stream_job(uuid, text, jsonb) to authenticated;
grant execute on function public.request_stream_job(uuid, text, jsonb) to service_role;

alter table public.stream_keys enable row level security;
alter table public.stream_keys force row level security;
alter table public.game_streams enable row level security;
alter table public.game_streams force row level security;
alter table public.stream_jobs enable row level security;
alter table public.stream_jobs force row level security;

revoke all on table public.stream_keys from public;
revoke all on table public.stream_keys from anon;
revoke all on table public.stream_keys from authenticated;
grant select, insert, update, delete on table public.stream_keys to authenticated;
grant select, insert, update, delete on table public.stream_keys to service_role;

revoke all on table public.game_streams from public;
revoke all on table public.game_streams from anon;
revoke all on table public.game_streams from authenticated;
grant select, update, delete on table public.game_streams to authenticated;
grant select, insert, update, delete on table public.game_streams to service_role;

revoke all on table public.stream_jobs from public;
revoke all on table public.stream_jobs from anon;
revoke all on table public.stream_jobs from authenticated;
grant select on table public.stream_jobs to authenticated;
grant select, insert, update, delete on table public.stream_jobs to service_role;

create policy stream_keys_select_member on public.stream_keys
  for select to authenticated
  using (true);

comment on policy stream_keys_select_member on public.stream_keys is
  'Every signed-in member can read key names for the stream pop-up.';

create policy stream_keys_insert_admin on public.stream_keys
  for insert to authenticated
  with check ((select private.current_role()) = 'admin');

create policy stream_keys_update_admin on public.stream_keys
  for update to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

create policy stream_keys_delete_admin on public.stream_keys
  for delete to authenticated
  using ((select private.current_role()) = 'admin');

create policy game_streams_select_member on public.game_streams
  for select to authenticated
  using (true);

comment on policy game_streams_select_member on public.game_streams is
  'Every signed-in member can read stream status and the public links.';

create policy game_streams_update_editor on public.game_streams
  for update to authenticated
  using (
    (select private.is_staff())
    or requested_by = (select auth.uid())
  )
  with check (
    (select private.is_staff())
    or requested_by = (select auth.uid())
  );

comment on policy game_streams_update_editor on public.game_streams is
  'Staff, or the member who started the stream, can edit a row. The guard trigger blocks players from status and result columns.';

create policy game_streams_delete_admin on public.game_streams
  for delete to authenticated
  using ((select private.current_role()) = 'admin');

create policy stream_jobs_select_member on public.stream_jobs
  for select to authenticated
  using (true);

comment on policy stream_jobs_select_member on public.stream_jobs is
  'Members read job status so the pop-up can show Queued while a job is pending. Inserts go through request_stream_job.';

alter table public.game_streams replica identity full;
alter table public.stream_jobs replica identity full;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'game_streams'
    ) then
      alter publication supabase_realtime add table public.game_streams;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'stream_jobs'
    ) then
      alter publication supabase_realtime add table public.stream_jobs;
    end if;
  end if;
end
$$;
