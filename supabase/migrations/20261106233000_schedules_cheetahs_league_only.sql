-- Schedules lists Cheetahs Alpha, Beta, and Gamma league games from the winter
-- sheet tabs only. Umpiring duties are other clubs' matchups and are not games.
-- 25 Oct 2026 Alpha vs BT Knights is not on the Alpha tab.

delete from public.schedule_events
where event_type = 'umpiring'
   or source_key = 'league:alpha:2026-10-25:10:30:bt knights'
   or (
     event_type = 'league_game'
     and game_date = date '2026-10-25'
     and opponent = 'BT Knights'
   );
