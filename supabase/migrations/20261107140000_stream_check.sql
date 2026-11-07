-- Look up an existing CricketCrazeUSA stream before offering to create one.
--
-- check is a stream_jobs action. While it runs, game_streams.status is checking.
-- checked_at records the last lookup so the pop-up does not queue another
-- automatic check for 10 minutes. Any signed-in member can also paste a YouTube
-- link through link_existing_stream; that sets awaiting_scorecard without a job.
-- The outside processor still does the CricketCrazeUSA lookup with the service role.

alter table public.game_streams
  add column if not exists checked_at timestamptz;

comment on column public.game_streams.checked_at is
  'When a CricketCrazeUSA lookup was last queued. The pop-up skips another automatic check for 10 minutes.';

comment on column public.game_streams.status is
  'none, checking, creating, awaiting_scorecard, setting_up_overlay, ready, ending, ended, or failed.';

alter table public.game_streams
  drop constraint game_streams_status_check;

alter table public.game_streams
  add constraint game_streams_status_check
  check (
    status in (
      'none',
      'checking',
      'creating',
      'awaiting_scorecard',
      'setting_up_overlay',
      'ready',
      'ending',
      'ended',
      'failed'
    )
  );

alter table public.stream_jobs
  drop constraint stream_jobs_action_check;

alter table public.stream_jobs
  add constraint stream_jobs_action_check
  check (action in ('check', 'create', 'add_scorecard', 'end'));

comment on table public.stream_jobs is
  'Queue for check, create, add_scorecard, and end. The outside processor marks jobs running, done, or failed.';

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

  if p_action not in ('check', 'create', 'add_scorecard', 'end') then
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

  if p_action = 'check' then
    if v_stream is not null and (
      v_stream.youtube_url is not null
      or v_stream.youtube_video_id is not null
      or v_stream.status not in ('none', 'failed', 'checking')
    ) then
      raise exception 'A stream already exists for this game.' using errcode = '22023';
    end if;

    v_next := 'checking';
    v_clean := '{}'::jsonb;

    if v_stream is null then
      insert into public.game_streams (
        schedule_event_id,
        status,
        requested_by,
        last_error,
        checked_at
      )
      values (p_schedule_event_id, v_next, v_uid, null, now())
      returning * into v_stream;
    else
      update public.game_streams
        set status = v_next,
            requested_by = coalesce(requested_by, v_uid),
            last_error = null,
            checked_at = now()
        where id = v_stream.id
        returning * into v_stream;
    end if;
  elsif p_action = 'create' then
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

    if v_stream is null then
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
    if v_stream is null
      or v_stream.status in ('none', 'checking', 'creating', 'ending')
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
    if v_stream is null or v_stream.status in ('none', 'checking', 'creating') then
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

create or replace function private.link_existing_stream(
  p_schedule_event_id uuid,
  p_youtube_url text
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
  v_url text;
  v_id text;
begin
  if v_uid is null then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;

  v_role := private.current_role();
  if v_role is null or v_role not in ('admin', 'captain', 'player') then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;

  v_url := btrim(coalesce(p_youtube_url, ''));
  v_url := regexp_replace(v_url, '^http://', 'https://', 'i');
  if char_length(v_url) < 17
    or char_length(v_url) > 500
    or v_url !~* '^https://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/[^[:space:]]+$'
  then
    raise exception 'Paste a YouTube link (youtube.com or youtu.be).' using errcode = '22023';
  end if;

  v_id := (regexp_match(v_url, 'youtu\.be/([A-Za-z0-9_-]{6,64})'))[1];
  if v_id is null then
    v_id := (regexp_match(v_url, '[?&]v=([A-Za-z0-9_-]{6,64})'))[1];
  end if;
  if v_id is null then
    v_id := (regexp_match(v_url, '/(?:live|embed|shorts)/([A-Za-z0-9_-]{6,64})'))[1];
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

  if v_stream is not null and exists (
    select 1
    from public.stream_jobs as job
    where job.game_stream_id = v_stream.id
      and job.status in ('pending', 'running')
  ) then
    raise exception 'A stream job is already queued for this game.' using errcode = 'P0001';
  end if;

  if v_stream is not null and (
    v_stream.youtube_url is not null
    or v_stream.youtube_video_id is not null
    or v_stream.status not in ('none', 'failed', 'checking')
  ) then
    raise exception 'A stream already exists for this game.' using errcode = '22023';
  end if;

  if v_stream is null then
    insert into public.game_streams (
      schedule_event_id,
      status,
      youtube_url,
      youtube_video_id,
      requested_by,
      last_error
    )
    values (p_schedule_event_id, 'awaiting_scorecard', v_url, v_id, v_uid, null)
    returning * into v_stream;
  else
    update public.game_streams
      set status = 'awaiting_scorecard',
          youtube_url = v_url,
          youtube_video_id = v_id,
          requested_by = coalesce(requested_by, v_uid),
          last_error = null
      where id = v_stream.id
      returning * into v_stream;
  end if;

  return jsonb_build_object(
    'game_stream_id', v_stream.id,
    'status', v_stream.status,
    'youtube_url', v_stream.youtube_url
  );
exception
  when unique_violation then
    raise exception 'A stream already exists for this game.' using errcode = 'P0001';
end;
$$;

comment on function private.link_existing_stream(uuid, text) is
  'Any signed-in member can attach a YouTube link when no stream is on file. Status becomes awaiting_scorecard.';

revoke all on function private.link_existing_stream(uuid, text) from public;
revoke all on function private.link_existing_stream(uuid, text) from anon;
grant execute on function private.link_existing_stream(uuid, text) to authenticated;
grant execute on function private.link_existing_stream(uuid, text) to service_role;

create or replace function public.link_existing_stream(
  p_schedule_event_id uuid,
  p_youtube_url text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.link_existing_stream(p_schedule_event_id, p_youtube_url);
$$;

comment on function public.link_existing_stream(uuid, text) is
  'Save a YouTube link for a game that has no stream yet. Any signed-in member can call it.';

revoke all on function public.link_existing_stream(uuid, text) from public;
revoke all on function public.link_existing_stream(uuid, text) from anon;
grant execute on function public.link_existing_stream(uuid, text) to authenticated;
grant execute on function public.link_existing_stream(uuid, text) to service_role;
