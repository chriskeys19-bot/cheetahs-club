-- Shared id for rows created from one recurring save.
-- Create expands a cadence into individual rows. Editing one row does not
-- change the others, and series_id is left in place for a later series edit.

alter table public.schedule_events
  add column series_id uuid;

comment on column public.schedule_events.series_id is
  'Shared id for schedule rows created together from one recurring save. Null for a one-off event.';

create index schedule_events_series_id_idx
  on public.schedule_events (series_id)
  where series_id is not null;

alter table public.activities
  add column series_id uuid;

comment on column public.activities.series_id is
  'Shared id for activity rows created together from one recurring save. Null for a one-off activity.';

create index activities_series_id_idx
  on public.activities (series_id)
  where series_id is not null;
