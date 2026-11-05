-- League games: home or away, optional ball and dress overrides, and a result.
-- Null ball_color and dress_code mean "use the side default" (Alpha and Beta:
-- white ball, Cheetahs colors; Gamma: pink ball, whites). The winter sheet has
-- no home/away column, so existing rows stay null until a captain sets them.

alter table public.schedule_events
  add column venue_side text,
  add column ball_color text,
  add column dress_code text,
  add column result text,
  add column scorecard_url text,
  add column match_status text not null default 'scheduled';

alter table public.schedule_events
  add constraint schedule_events_venue_side_check
    check (venue_side is null or venue_side in ('home', 'away')),
  add constraint schedule_events_ball_color_check
    check (ball_color is null or ball_color in ('white', 'pink')),
  add constraint schedule_events_dress_code_check
    check (dress_code is null or dress_code in ('cheetahs_colors', 'whites')),
  add constraint schedule_events_result_check
    check (result is null or result in ('win', 'loss', 'draw', 'nr')),
  add constraint schedule_events_scorecard_url_check
    check (
      scorecard_url is null
      or (
        char_length(btrim(scorecard_url)) between 8 and 500
        and btrim(scorecard_url) ~* '^https?://[^[:space:]]+$'
      )
    ),
  add constraint schedule_events_match_status_check
    check (match_status in ('scheduled', 'completed')),
  add constraint schedule_events_league_details_check
    check (
      event_type = 'league_game'
      or (
        venue_side is null
        and ball_color is null
        and dress_code is null
        and result is null
        and scorecard_url is null
        and match_status = 'scheduled'
      )
    );

comment on column public.schedule_events.venue_side is
  'home or away for a league game. Null until a captain sets it. The winter sheet did not mark home or away.';

comment on column public.schedule_events.ball_color is
  'Optional override. Null uses the side default: white for Alpha and Beta, pink for Gamma.';

comment on column public.schedule_events.dress_code is
  'Optional override. Null uses the side default: cheetahs_colors for Alpha and Beta, whites for Gamma.';

comment on column public.schedule_events.result is
  'win, loss, draw, or nr. Shown once the game is completed.';

comment on column public.schedule_events.scorecard_url is
  'https scorecard link. Shown once the game is completed.';

comment on column public.schedule_events.match_status is
  'scheduled or completed. A past start is also treated as completed in the app.';

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
    new.match_status := 'scheduled';
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
