-- CricketCraze stream scorecards, matched on side + opponent + Pacific date.
-- The public CricClubs pages did not return a verifiable win or loss, so result
-- stays null for a captain to set. The winter sheet has no 25 Oct 2026 row, so
-- that Alpha vs BT Knights game is inserted here.

update public.schedule_events as event
set scorecard_url = 'https://cricclubs.com/NCCA/results/hOQ53-q-c5JY8-5irinE0A?asfd=Cheetahs+Beta+vs+Livermore+Monks'
from public.teams as team
where event.team_id = team.id
  and team.slug = 'beta'
  and event.event_type = 'league_game'
  and event.game_date = date '2026-11-01'
  and event.start_time = time '08:45'
  and event.opponent = 'Livermore Monks'
  and event.scorecard_url is null;

update public.schedule_events as event
set scorecard_url = 'https://cricclubs.com/NCCA/results/2rg9xZOSuJxGwE_rdEuaGw?asfd=Cheetahs+Alpha+vs+Cougars+Black'
from public.teams as team
where event.team_id = team.id
  and team.slug = 'alpha'
  and event.event_type = 'league_game'
  and event.game_date = date '2026-11-01'
  and event.start_time = time '12:45'
  and event.opponent = 'Cougars Black'
  and event.scorecard_url is null;

insert into public.schedule_events (
  source_key,
  team_id,
  umpiring_team_id,
  game_date,
  start_time,
  match_format,
  ground,
  address,
  opponent,
  event_type,
  notes,
  scorecard_url
)
select
  'league:alpha:2026-10-25:10:30:bt knights',
  team.id,
  null,
  date '2026-10-25',
  time '10:30',
  'T20',
  'Caroline Davis School',
  '5036 Edenview Dr, San Jose',
  'BT Knights',
  'league_game',
  'Played before the winter sheet. Scorecard from the club stream list.',
  'https://cricclubs.com/NCCA/results/4osfL-x0eWfNplPBds6p7A?asfd=BT+Knights+vs+Cheetahs+Alpha'
from public.teams as team
where team.slug = 'alpha'
on conflict (source_key) do update
set scorecard_url = excluded.scorecard_url
where public.schedule_events.scorecard_url is null;
