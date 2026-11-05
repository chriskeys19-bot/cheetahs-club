-- Scorecards are public CricClubs HTTPS links. YouTube and other hosts are not stored.

alter table public.schedule_events
  drop constraint schedule_events_scorecard_url_check;

alter table public.schedule_events
  add constraint schedule_events_scorecard_url_check
  check (
    scorecard_url is null
    or (
      char_length(btrim(scorecard_url)) between 12 and 500
      and btrim(scorecard_url) ~* '^https://([a-z0-9-]+\.)*cricclubs\.com/[^[:space:]]+$'
    )
  );

comment on column public.schedule_events.scorecard_url is
  'Public https://cricclubs.com scorecard. Shown once the league game is completed. Captains paste the link used for the stream.';
