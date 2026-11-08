-- Let the scorecard worker publish the overlay before YouTube and CricClubs finish.
--
-- updating_stream means the overlay link is saved and the worker is still
-- updating the YouTube description and CricClubs. The app shows that link
-- immediately, including if the second phase later fails.
--
-- When the pasted scorecard already has matchId and clubId, request_stream_job
-- stores the CricClubs overlay URL in the same transaction as the job. Encoded
-- links such as /results/<code> stay null until the worker resolves them.
-- The worker still writes overlay_short_url.

comment on column public.game_streams.status is
  'none, checking, creating, awaiting_scorecard, setting_up_overlay, updating_stream, ready, ending, ended, or failed.';

alter table public.game_streams
  drop constraint if exists game_streams_status_check;

alter table public.game_streams
  add constraint game_streams_status_check
  check (
    status in (
      'none',
      'checking',
      'creating',
      'awaiting_scorecard',
      'setting_up_overlay',
      'updating_stream',
      'ready',
      'ending',
      'ended',
      'failed'
    )
  );

create or replace function private.overlay_url_from_scorecard(p_url text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_query text;
  v_match text;
  v_club text;
  v_part text;
  v_key text;
  v_value text;
begin
  if p_url is null or position('?' in p_url) = 0 then
    return null;
  end if;

  v_query := split_part(split_part(p_url, '?', 2), '#', 1);
  foreach v_part in array string_to_array(v_query, '&')
  loop
    v_key := lower(split_part(v_part, '=', 1));
    v_value := split_part(v_part, '=', 2);
    if v_value !~ '^[0-9]{1,12}$' then
      continue;
    end if;
    if v_key = 'matchid' and v_match is null then
      v_match := v_value;
    elsif v_key = 'clubid' and v_club is null then
      v_club := v_value;
    end if;
  end loop;

  if v_match is null or v_club is null then
    return null;
  end if;

  return 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId='
    || v_match
    || '&clubId='
    || v_club;
end;
$$;

comment on function private.overlay_url_from_scorecard(text) is
  'CricClubs overlay for a scorecard URL that already includes matchId and clubId. Null for encoded result links.';

revoke all on function private.overlay_url_from_scorecard(text) from public;
revoke all on function private.overlay_url_from_scorecard(text) from anon;
revoke all on function private.overlay_url_from_scorecard(text) from authenticated;

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
