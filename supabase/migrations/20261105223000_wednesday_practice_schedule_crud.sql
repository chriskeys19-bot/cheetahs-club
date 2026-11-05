-- Club-wide Wednesday practice, optional end times, and creator write access.
--
-- The clubhouse week is Monday–Sunday in America/Los_Angeles. That window is
-- applied in the client from game_date (already a Pacific civil date). This
-- migration does not store a week boundary.
--
-- Practice seed: the next Wednesday after 2026-11-05 is 2026-11-11. Winter
-- league fixtures run through 2027-03-28, so Wednesday practice is seeded
-- through 2027-03-31 (the last Wednesday of that month), 8:30–10:00 PM
-- America/Los_Angeles, at US Cricket Store, 121 Ranch Dr, Milpitas.

alter table public.schedule_events
  add column end_time time,
  add column created_by uuid references auth.users (id) on delete set null;

alter table public.schedule_events
  add column ends_at timestamptz generated always as (
    case
      when end_time is null then null
      else (game_date + end_time) at time zone 'America/Los_Angeles'
    end
  ) stored;

comment on column public.schedule_events.end_time is
  'Optional America/Los_Angeles wall-clock finish. Null when the event has no set end.';

comment on column public.schedule_events.ends_at is
  'UTC instant for end_time on game_date. Null when end_time is null.';

comment on column public.schedule_events.created_by is
  'Member who added the row. Stamped from auth.uid() on insert. Seeded rows stay null. Admins, captains, and this user may update or delete.';

alter table public.schedule_events
  drop constraint schedule_events_type_check;

alter table public.schedule_events
  add constraint schedule_events_type_check
  check (event_type in ('league_game', 'umpiring', 'practice', 'other'));

alter table public.schedule_events
  drop constraint schedule_events_shape;

alter table public.schedule_events
  add constraint schedule_events_shape
  check (
    (
      event_type = 'league_game'
      and team_id is not null
      and umpiring_team_id is null
    )
    or (
      event_type = 'umpiring'
      and umpiring_team_id is not null
      and (team_id is null or team_id = umpiring_team_id)
    )
    or (
      event_type in ('practice', 'other')
      and umpiring_team_id is null
    )
  );

alter table public.schedule_events
  add constraint schedule_events_end_after_start
  check (end_time is null or end_time > start_time);

comment on table public.schedule_events is
  'League games, umpiring duties, club practice, and other events. game_date, start_time, and end_time are America/Los_Angeles wall clock. starts_at and ends_at are the matching UTC instants. A null team_id on practice or other means club-wide. Availability is not stored.';

create index schedule_events_created_by_idx
  on public.schedule_events (created_by)
  where created_by is not null;

create or replace function private.stamp_schedule_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Migrations and the service role seed rows with no JWT. Signed-in writes
  -- must be staff on insert, or staff or the original creator on update.
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

revoke all on function private.stamp_schedule_event() from public;
revoke all on function private.stamp_schedule_event() from anon;
grant execute on function private.stamp_schedule_event() to authenticated;
grant execute on function private.stamp_schedule_event() to service_role;

create trigger schedule_events_stamp
  before insert or update on public.schedule_events
  for each row
  execute function private.stamp_schedule_event();

comment on function private.stamp_schedule_event() is
  'Trims schedule text, keeps umpiring team ids consistent, and stamps created_by from the signed-in user. Seed inserts with no JWT are left unchanged.';

-- One policy per action so staff and the creating member share a single check.
drop policy schedule_events_update_staff on public.schedule_events;
create policy schedule_events_update_staff on public.schedule_events
  for update to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  )
  with check (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy schedule_events_update_staff on public.schedule_events is
  'Admin, captain, or the member who created the event can edit it.';

drop policy schedule_events_delete_staff on public.schedule_events;
create policy schedule_events_delete_staff on public.schedule_events
  for delete to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy schedule_events_delete_staff on public.schedule_events is
  'Admin, captain, or the member who created the event can delete it.';

comment on policy schedule_events_select_member on public.schedule_events is
  'Any signed-in member can read league games, umpiring, practice, and other events.';

comment on policy schedule_events_insert_staff on public.schedule_events is
  'Admin and captain can add schedule events. The stamp trigger sets created_by.';

insert into public.schedule_events (
  source_key,
  team_id,
  umpiring_team_id,
  game_date,
  start_time,
  end_time,
  match_format,
  ground,
  address,
  opponent,
  event_type,
  division,
  notes
)
select
  'practice:wednesday:' || to_char(practice_day, 'YYYY-MM-DD'),
  null,
  null,
  practice_day,
  time '20:30',
  time '22:00',
  null,
  'US Cricket Store',
  '121 Ranch Dr, Milpitas, CA 95035',
  'Cheetahs practice',
  'practice',
  null,
  'Club-wide Wednesday nets, 8:30–10:00 PM Pacific.'
from (
  select practice_at::date as practice_day
  from generate_series(
    timestamp '2026-11-11',
    timestamp '2027-03-31',
    interval '7 days'
  ) as days(practice_at)
) as wednesdays
on conflict (source_key) do nothing;
