-- Shorten a stuck stream step from 30 minutes to 7, and check every minute.
--
-- 20261114152030_stream_job_failure_releases_stream.sql and
-- 20261114171048_stream_retry_assigned_key.sql already ran in production with
-- a 30-minute threshold and a 10-minute cron. This file replaces those
-- definitions. It is safe to run again, and safe if the same statements were
-- applied through the Supabase SQL editor first.
--
-- Retry inside private.request_stream_job uses the same 7-minute cutoff, so
-- the button can enqueue a fresh job as soon as the pop-up offers Retry.

create or replace function private.expire_stale_stream_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.stream_jobs
     set status = 'failed',
         error = 'This stream step timed out after 7 minutes. Tap Retry.'
   where status in ('pending', 'running')
     and updated_at < now() - interval '7 minutes';

  update public.game_streams gs
     set status = 'failed',
         last_error = 'This stream step stopped without finishing. Tap Retry.'
   where gs.status in ('checking', 'creating', 'setting_up_overlay', 'updating_stream', 'ending')
     and gs.updated_at < now() - interval '7 minutes'
     and not exists (
       select 1
       from public.stream_jobs j
       where j.game_stream_id = gs.id
         and j.status in ('pending', 'running')
     );
end
$$;

comment on function private.expire_stale_stream_jobs() is
  'Fail pending or running stream jobs older than 7 minutes, and fail in-progress streams that have no active job and have not been updated for 7 minutes.';

revoke all on function private.expire_stale_stream_jobs() from public;
revoke all on function private.expire_stale_stream_jobs() from anon;
revoke all on function private.expire_stale_stream_jobs() from authenticated;

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
  v_overlay text;
  v_next text;
  v_job_id uuid;
  v_clean jsonb;
  v_match_status text;
  v_result text;
  v_constraint text;
  v_detail text;
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

  select event.event_type, team.slug, event.match_status, event.result
    into v_event_type, v_slug, v_match_status, v_result
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

  -- A step that has already sat for 7 minutes should not block Retry.
  -- Failing it releases the in-progress stream through stream_jobs_failed_release.
  if v_stream.id is not null then
    update public.stream_jobs
      set status = 'failed',
          error = 'This stream step timed out after 7 minutes. Tap Retry.'
      where game_stream_id = v_stream.id
        and status in ('pending', 'running')
        and updated_at < now() - interval '7 minutes';

    select * into v_stream
    from public.game_streams
    where id = v_stream.id
    for update;
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
    -- checking and creating stay retryable when the previous job failed or
    -- vanished and no YouTube video was stored. The open-job check above
    -- still blocks a second create while one is actually pending or running.
    if v_stream is not null and (
      v_stream.status not in ('none', 'failed', 'checking', 'creating')
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

    -- pick_free_stream_key may have moved this game onto a different device.
    v_clean := jsonb_build_object('stream_key_name', v_stream.stream_key_name);
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
    v_overlay := private.overlay_url_from_scorecard(v_scorecard);
    v_next := 'setting_up_overlay';
    v_clean := jsonb_build_object('scorecard_url', v_scorecard);

    if v_overlay is null then
      update public.game_streams
        set status = v_next,
            scorecard_url = v_scorecard,
            last_error = null
        where id = v_stream.id
        returning * into v_stream;
    else
      update public.game_streams
        set status = v_next,
            scorecard_url = v_scorecard,
            overlay_url = v_overlay,
            overlay_short_url = null,
            last_error = null
        where id = v_stream.id
        returning * into v_stream;
    end if;
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

    -- Same staff check as private.is_staff(): admin or captain.
    -- A completed game keeps the automatic end for any signed-in member.
    if v_role not in ('admin', 'captain')
      and v_match_status is distinct from 'completed'
      and v_result is null
    then
      raise exception 'Only a captain or admin can end a stream.' using errcode = '42501';
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
    'job_status', 'pending',
    'stream_key_name', v_stream.stream_key_name
  );
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name, v_detail = message_text;
    if v_constraint = 'game_streams_one_live_key_idx'
      or v_detail like '%game_streams_one_live_key_idx%'
    then
      raise exception 'That stream key is already in use. Choose a free key.'
        using errcode = 'P0001';
    end if;
    raise exception 'A stream job is already queued for this game.' using errcode = 'P0001';
end;
$$;

comment on function public.request_stream_job(uuid, text, jsonb) is
  'Queues one stream job after checking the game, the action, and any open job. A create can be retried from checking or creating when no fresh job is open and no YouTube video was saved. A job older than 7 minutes is failed first so Retry enqueues a new one. The create payload stores the stream key saved on the game after a busy device is reassigned. A scorecard with matchId and clubId stores the CricClubs overlay immediately. Ending a stream before the game is completed is limited to captains and admins. A completed game (match_status completed or a result) can still be ended by any signed-in member, which is the automatic end. Direct inserts are not granted.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-stream-jobs') then
    perform cron.unschedule('expire-stale-stream-jobs');
  end if;
end
$$;

select cron.schedule(
  'expire-stale-stream-jobs',
  '* * * * *',
  $$select private.expire_stale_stream_jobs()$$
);
