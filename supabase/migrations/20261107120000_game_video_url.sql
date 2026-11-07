-- Optional match video on a league game. Members can read it. Captains and
-- admins write it. The row update policy is still schedule_events_update_staff
-- (private.is_staff() or the creating member), the same check that already
-- gates result edits. stamp_schedule_event additionally rejects a video_url
-- change unless private.is_staff(), so a player cannot add, edit, or clear it.

alter table public.schedule_events
  add column video_url text;

alter table public.schedule_events
  add constraint schedule_events_video_url_check
  check (
    video_url is null
    or (
      char_length(btrim(video_url)) between 17 and 500
      and btrim(video_url) ~* '^https?://([a-z0-9-]+\.)*(youtube\.com|youtu\.be)/[^[:space:]]+$'
    )
  );

comment on column public.schedule_events.video_url is
  'Optional http or https YouTube link (youtube.com or youtu.be), including subdomains such as www, m, and music. Shown on a completed league game. Null clears it.';

comment on constraint schedule_events_video_url_check on public.schedule_events is
  'Match video must be an http(s) youtube.com or youtu.be URL, 17 to 500 characters after trim.';

alter table public.schedule_events
  drop constraint schedule_events_league_details_check;

alter table public.schedule_events
  add constraint schedule_events_league_details_check
  check (
    event_type = 'league_game'
    or (
      venue_side is null
      and ball_color is null
      and dress_code is null
      and result is null
      and scorecard_url is null
      and video_url is null
      and match_status = 'scheduled'
    )
  );

comment on policy schedule_events_update_staff on public.schedule_events is
  'Admin or captain (private.is_staff()) or the creating member can edit the row, including result. A video_url change also requires private.is_staff() inside stamp_schedule_event, so players can only read the match video.';

create or replace function private.stamp_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' and not (select private.is_staff()) then
      raise exception 'staff role required' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE'
      and not (select private.is_staff())
      and old.created_by is distinct from (select auth.uid())
    then
      raise exception 'staff role required' using errcode = '42501';
    end if;
  end if;

  new.ground := btrim(new.ground);
  new.opponent := btrim(new.opponent);
  if new.address is not null then
    new.address := nullif(btrim(new.address), '');
  end if;
  if new.notes is not null then
    new.notes := nullif(btrim(new.notes), '');
  end if;
  if new.match_format is not null then
    new.match_format := nullif(btrim(new.match_format), '');
  end if;
  if new.division is not null then
    new.division := nullif(btrim(new.division), '');
  end if;
  if new.scorecard_url is not null then
    new.scorecard_url := nullif(btrim(new.scorecard_url), '');
  end if;
  if new.video_url is not null then
    new.video_url := nullif(btrim(new.video_url), '');
  end if;
  if new.match_status is null or btrim(new.match_status) = '' then
    new.match_status := 'scheduled';
  end if;

  if new.event_type = 'umpiring' then
    if new.umpiring_team_id is null then
      new.umpiring_team_id := new.team_id;
    end if;
    if new.team_id is null then
      new.team_id := new.umpiring_team_id;
    end if;
  else
    new.umpiring_team_id := null;
  end if;

  if new.event_type is distinct from 'league_game' then
    new.venue_side := null;
    new.ball_color := null;
    new.dress_code := null;
    new.result := null;
    new.scorecard_url := null;
    new.video_url := null;
    new.match_status := 'scheduled';
  end if;

  if tg_op = 'UPDATE'
    and new.video_url is distinct from old.video_url
    and (select auth.uid()) is not null
    and not (select private.is_staff())
  then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    if (select auth.uid()) is not null then
      new.created_by := (select auth.uid());
    end if;
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.source_key := old.source_key;
  end if;

  return new;
end;
$$;
