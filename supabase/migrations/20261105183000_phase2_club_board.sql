-- Phase 2: announcements, activities, schedules, and polls.
--
-- Access matrix (RLS, role authenticated only; anon has no grants):
--   announcements, activities, schedule_events, polls, poll_options
--     select: any signed-in member
--     insert / update / delete: admin or captain (private.is_staff)
--   poll_votes
--     select: the voter, or admin/captain
--     insert / update: the voter, and only while the poll is open
--   poll result counts: public.poll_tallies() (security invoker wrapper).
--     The count query itself is private.poll_tallies(), security definer,
--     so members can see totals without reading other people's voter ids.
--
-- Identity columns (author_id, created_by, voter_id) are stamped from
-- auth.uid() in private triggers. Clients cannot file a row as someone else.
-- Schedule wall times are Pacific. starts_at stores that instant in UTC,
-- including the America/Los_Angeles daylight-saving rules.

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_role() in ('admin', 'captain'), false);
$$;

revoke all on function private.is_staff() from public;
revoke all on function private.is_staff() from anon;
grant execute on function private.is_staff() to authenticated;
grant execute on function private.is_staff() to service_role;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_id uuid references auth.users (id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length check (char_length(btrim(title)) between 1 and 140),
  constraint announcements_body_length check (char_length(btrim(body)) between 1 and 4000)
);

comment on table public.announcements is
  'Club-wide updates. Admin and captain write; every signed-in member reads.';

create index announcements_list_idx
  on public.announcements (pinned desc, created_at desc);

create index announcements_author_idx
  on public.announcements (author_id);

create index if not exists team_members_profile_idx
  on public.team_members (profile_id);

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  location text,
  team_id uuid references public.teams (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint activities_title_length check (char_length(btrim(title)) between 1 and 140),
  constraint activities_description_length check (
    description is null or char_length(btrim(description)) between 1 and 2000
  ),
  constraint activities_location_length check (
    location is null or char_length(btrim(location)) between 1 and 200
  ),
  constraint activities_ends_after_start check (ends_at is null or ends_at >= starts_at)
);

comment on table public.activities is
  'Club and team activities. starts_at is UTC. Null team_id means club-wide.';

create index activities_starts_at_idx
  on public.activities (starts_at);

create index activities_team_idx
  on public.activities (team_id);

create index activities_created_by_idx
  on public.activities (created_by);

create table public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique default gen_random_uuid()::text,
  team_id uuid references public.teams (id) on delete restrict,
  umpiring_team_id uuid references public.teams (id) on delete restrict,
  game_date date not null,
  start_time time not null,
  starts_at timestamptz generated always as (
    (game_date + start_time) at time zone 'America/Los_Angeles'
  ) stored,
  match_format text,
  ground text not null,
  address text,
  opponent text not null,
  event_type text not null,
  division text,
  notes text,
  created_at timestamptz not null default now(),
  constraint schedule_events_type_check check (event_type in ('league_game', 'umpiring')),
  constraint schedule_events_format_length check (
    match_format is null or char_length(btrim(match_format)) between 1 and 40
  ),
  constraint schedule_events_ground_length check (char_length(btrim(ground)) between 1 and 160),
  constraint schedule_events_address_length check (
    address is null or char_length(btrim(address)) between 1 and 240
  ),
  constraint schedule_events_opponent_length check (char_length(btrim(opponent)) between 1 and 160),
  constraint schedule_events_division_length check (
    division is null or char_length(btrim(division)) between 1 and 40
  ),
  constraint schedule_events_notes_length check (
    notes is null or char_length(btrim(notes)) between 1 and 500
  ),
  constraint schedule_events_shape check (
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
  )
);

comment on table public.schedule_events is
  'League games and umpiring duties. game_date and start_time are America/Los_Angeles wall clock. starts_at is the matching UTC instant. Availability is not stored.';

comment on column public.schedule_events.source_key is
  'Stable seed identity (league:* or umpire:*). Manual rows get a random key.';

create index schedule_events_starts_idx
  on public.schedule_events (starts_at);

create index schedule_events_team_date_idx
  on public.schedule_events (team_id, game_date, start_time);

create index schedule_events_type_idx
  on public.schedule_events (event_type, starts_at);

create index schedule_events_umpiring_team_idx
  on public.schedule_events (umpiring_team_id);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  description text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  closes_at timestamptz,
  status text not null default 'open',
  constraint polls_question_length check (char_length(btrim(question)) between 1 and 280),
  constraint polls_description_length check (
    description is null or char_length(btrim(description)) between 1 and 2000
  ),
  constraint polls_status_check check (status in ('open', 'closed'))
);

comment on table public.polls is
  'Club polls. Admin and captain create and close them. A poll is votable only while status is open and closes_at is null or still in the future.';

create index polls_created_idx
  on public.polls (created_at desc);

create index polls_created_by_idx
  on public.polls (created_by);

create or replace function private.poll_is_open(p_poll_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.polls as p
    where p.id = p_poll_id
      and p.status = 'open'
      and (p.closes_at is null or p.closes_at > now())
  );
$$;

revoke all on function private.poll_is_open(uuid) from public;
revoke all on function private.poll_is_open(uuid) from anon;
grant execute on function private.poll_is_open(uuid) to authenticated;
grant execute on function private.poll_is_open(uuid) to service_role;

create table public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls (id) on delete cascade,
  label text not null,
  sort_order integer not null default 0,
  constraint poll_options_label_length check (char_length(btrim(label)) between 1 and 120),
  constraint poll_options_sort_order_check check (sort_order >= 0),
  constraint poll_options_poll_label_unique unique (poll_id, label)
);

create index poll_options_poll_idx
  on public.poll_options (poll_id, sort_order);

create table public.poll_votes (
  poll_id uuid not null references public.polls (id) on delete cascade,
  option_id uuid not null references public.poll_options (id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  voted_at timestamptz not null default now(),
  primary key (poll_id, voter_id)
);

comment on table public.poll_votes is
  'One row per member per poll. Voters can read their own row. Admin and captain can read every row. Totals for everyone else come from poll_tallies().';

create index poll_votes_option_idx
  on public.poll_votes (option_id);

create index poll_votes_voter_idx
  on public.poll_votes (voter_id);

create or replace function private.stamp_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  new.body := btrim(new.body);

  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
  else
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_announcement() from public;
revoke all on function private.stamp_announcement() from anon;
grant execute on function private.stamp_announcement() to authenticated;
grant execute on function private.stamp_announcement() to service_role;

create trigger announcements_stamp
  before insert or update on public.announcements
  for each row
  execute function private.stamp_announcement();

create or replace function private.stamp_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;
  if new.location is not null then
    new.location := nullif(btrim(new.location), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_activity() from public;
revoke all on function private.stamp_activity() from anon;
grant execute on function private.stamp_activity() to authenticated;
grant execute on function private.stamp_activity() to service_role;

create trigger activities_stamp
  before insert or update on public.activities
  for each row
  execute function private.stamp_activity();

create or replace function private.stamp_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.question := btrim(new.question);
  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.status := coalesce(nullif(btrim(new.status), ''), 'open');
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

revoke all on function private.stamp_poll() from public;
revoke all on function private.stamp_poll() from anon;
grant execute on function private.stamp_poll() to authenticated;
grant execute on function private.stamp_poll() to service_role;

create trigger polls_stamp
  before insert or update on public.polls
  for each row
  execute function private.stamp_poll();

create or replace function private.guard_poll_vote()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_option_poll uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.voter_id is distinct from (select auth.uid()) then
    raise exception 'not your vote' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.poll_id is distinct from old.poll_id then
    raise exception 'poll cannot change' using errcode = '42501';
  end if;

  new.voter_id := (select auth.uid());
  new.voted_at := now();

  if not (select private.poll_is_open(new.poll_id)) then
    raise exception 'poll is closed' using errcode = '42501';
  end if;

  select o.poll_id
    into v_option_poll
  from public.poll_options as o
  where o.id = new.option_id;

  if v_option_poll is distinct from new.poll_id then
    raise exception 'option does not belong to poll' using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_poll_vote() from public;
revoke all on function private.guard_poll_vote() from anon;
grant execute on function private.guard_poll_vote() to authenticated;
grant execute on function private.guard_poll_vote() to service_role;

create trigger poll_votes_guard
  before insert or update on public.poll_votes
  for each row
  execute function private.guard_poll_vote();

create or replace function private.poll_tallies()
returns table (poll_id uuid, option_id uuid, votes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.poll_id, v.option_id, count(*)::integer
  from public.poll_votes as v
  where (select auth.uid()) is not null
  group by v.poll_id, v.option_id;
$$;

revoke all on function private.poll_tallies() from public;
revoke all on function private.poll_tallies() from anon;
grant execute on function private.poll_tallies() to authenticated;
grant execute on function private.poll_tallies() to service_role;

create or replace function public.poll_tallies()
returns table (poll_id uuid, option_id uuid, votes integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select tallies.poll_id, tallies.option_id, tallies.votes
  from private.poll_tallies() as tallies;
$$;

comment on function public.poll_tallies() is
  'Vote totals for signed-in members. Does not return voter ids. Counting runs in private.poll_tallies() as security definer.';

revoke all on function public.poll_tallies() from public;
revoke all on function public.poll_tallies() from anon;
grant execute on function public.poll_tallies() to authenticated;
grant execute on function public.poll_tallies() to service_role;

alter table public.announcements enable row level security;
alter table public.activities enable row level security;
alter table public.schedule_events enable row level security;
alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;

alter table public.announcements force row level security;
alter table public.activities force row level security;
alter table public.schedule_events force row level security;
alter table public.polls force row level security;
alter table public.poll_options force row level security;
alter table public.poll_votes force row level security;

revoke all on table public.announcements from public;
revoke all on table public.announcements from anon;
revoke all on table public.announcements from authenticated;
grant select, insert, update, delete on table public.announcements to authenticated;
grant select, insert, update, delete on table public.announcements to service_role;

revoke all on table public.activities from public;
revoke all on table public.activities from anon;
revoke all on table public.activities from authenticated;
grant select, insert, update, delete on table public.activities to authenticated;
grant select, insert, update, delete on table public.activities to service_role;

revoke all on table public.schedule_events from public;
revoke all on table public.schedule_events from anon;
revoke all on table public.schedule_events from authenticated;
grant select, insert, update, delete on table public.schedule_events to authenticated;
grant select, insert, update, delete on table public.schedule_events to service_role;

revoke all on table public.polls from public;
revoke all on table public.polls from anon;
revoke all on table public.polls from authenticated;
grant select, insert, update, delete on table public.polls to authenticated;
grant select, insert, update, delete on table public.polls to service_role;

revoke all on table public.poll_options from public;
revoke all on table public.poll_options from anon;
revoke all on table public.poll_options from authenticated;
grant select, insert, update, delete on table public.poll_options to authenticated;
grant select, insert, update, delete on table public.poll_options to service_role;

revoke all on table public.poll_votes from public;
revoke all on table public.poll_votes from anon;
revoke all on table public.poll_votes from authenticated;
grant select, insert, update on table public.poll_votes to authenticated;
grant select, insert, update, delete on table public.poll_votes to service_role;

-- Signed-in reads. auth.uid() is required so a JWT without a subject sees nothing.
create policy announcements_select_member on public.announcements
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy announcements_select_member on public.announcements is
  'Any signed-in member can read announcements.';

create policy announcements_insert_staff on public.announcements
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy announcements_insert_staff on public.announcements is
  'Admin and captain can post announcements. The stamp trigger sets author_id.';

create policy announcements_update_staff on public.announcements
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy announcements_update_staff on public.announcements is
  'Admin and captain can edit or pin announcements.';

create policy announcements_delete_staff on public.announcements
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy announcements_delete_staff on public.announcements is
  'Admin and captain can remove announcements.';

create policy activities_select_member on public.activities
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy activities_select_member on public.activities is
  'Any signed-in member can read the activity feed.';

create policy activities_insert_staff on public.activities
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy activities_insert_staff on public.activities is
  'Admin and captain can add activities.';

create policy activities_update_staff on public.activities
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy activities_update_staff on public.activities is
  'Admin and captain can edit activities.';

create policy activities_delete_staff on public.activities
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy activities_delete_staff on public.activities is
  'Admin and captain can remove activities.';

create policy schedule_events_select_member on public.schedule_events
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy schedule_events_select_member on public.schedule_events is
  'Any signed-in member can read league games and umpiring duties. Team filters are a client concern; membership does not hide other sides.';

create policy schedule_events_insert_staff on public.schedule_events
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy schedule_events_insert_staff on public.schedule_events is
  'Admin and captain can add fixtures.';

create policy schedule_events_update_staff on public.schedule_events
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy schedule_events_update_staff on public.schedule_events is
  'Admin and captain can edit fixtures.';

create policy schedule_events_delete_staff on public.schedule_events
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy schedule_events_delete_staff on public.schedule_events is
  'Admin and captain can remove fixtures.';

create policy polls_select_member on public.polls
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy polls_select_member on public.polls is
  'Any signed-in member can read polls.';

create policy polls_insert_staff on public.polls
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy polls_insert_staff on public.polls is
  'Admin and captain can create polls.';

create policy polls_update_staff on public.polls
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy polls_update_staff on public.polls is
  'Admin and captain can edit or close polls.';

create policy polls_delete_staff on public.polls
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy polls_delete_staff on public.polls is
  'Admin and captain can delete polls. Options and votes cascade.';

create policy poll_options_select_member on public.poll_options
  for select to authenticated
  using ((select auth.uid()) is not null);

comment on policy poll_options_select_member on public.poll_options is
  'Any signed-in member can read poll choices.';

create policy poll_options_insert_staff on public.poll_options
  for insert to authenticated
  with check ((select private.is_staff()));

comment on policy poll_options_insert_staff on public.poll_options is
  'Admin and captain can add choices.';

create policy poll_options_update_staff on public.poll_options
  for update to authenticated
  using ((select private.is_staff()))
  with check ((select private.is_staff()));

comment on policy poll_options_update_staff on public.poll_options is
  'Admin and captain can rename choices.';

create policy poll_options_delete_staff on public.poll_options
  for delete to authenticated
  using ((select private.is_staff()));

comment on policy poll_options_delete_staff on public.poll_options is
  'Admin and captain can remove choices. Votes on that choice cascade.';

create policy poll_votes_select_own_or_staff on public.poll_votes
  for select to authenticated
  using (
    voter_id = (select auth.uid())
    or (select private.is_staff())
  );

comment on policy poll_votes_select_own_or_staff on public.poll_votes is
  'A member can read their own vote. Admin and captain can read each vote. Everyone else uses poll_tallies() for counts.';

create policy poll_votes_insert_own on public.poll_votes
  for insert to authenticated
  with check (
    voter_id = (select auth.uid())
    and (select private.poll_is_open(poll_id))
    and exists (
      select 1
      from public.poll_options as o
      where o.id = option_id
        and o.poll_id = poll_votes.poll_id
    )
  );

comment on policy poll_votes_insert_own on public.poll_votes is
  'A signed-in member can cast one vote on an open poll, for a choice that belongs to that poll.';

create policy poll_votes_update_own on public.poll_votes
  for update to authenticated
  using (voter_id = (select auth.uid()))
  with check (
    voter_id = (select auth.uid())
    and (select private.poll_is_open(poll_id))
    and exists (
      select 1
      from public.poll_options as o
      where o.id = option_id
        and o.poll_id = poll_votes.poll_id
    )
  );

comment on policy poll_votes_update_own on public.poll_votes is
  'A member can change their own vote while the poll is still open.';

-- Winter 2026-27 snapshot.
-- League rows: public sheet tabs Alpha / Beta / Gamma - Winter 2026.
-- Dates match schedules-parsed.json dates_corrected_for_today_2026_11_05
-- (today 2026-11-05: November and December 2026, January through March 2027).
-- Beta and Gamma addresses and formats were not in that JSON; they come from
-- the same sheet. Availability grids are intentionally not loaded.
-- Umpiring tab: 18 duties. January through March were entered as 2026 on that
-- tab; those dates are stored as 2027 so they stay in this winter season.
-- Sheet: https://docs.google.com/spreadsheets/d/1vPF5EI1S6J-FdAWSlIq-eAL7_VCApJ2ZZIEkGx5FfBc/edit

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
  division,
  notes
)
select
  v.source_key,
  side.id,
  umpire.id,
  v.game_date,
  v.start_time,
  v.match_format,
  v.ground,
  v.address,
  v.opponent,
  v.event_type,
  v.division,
  v.notes
from (
  values
  ('league:alpha:2026-11-01:12:45:cougars black', 'alpha', null::text, '2026-11-01'::date, '12:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'Cougars Black', 'league_game', null::text, null::text),
  ('league:alpha:2026-11-08:08:45:tracy centurions', 'alpha', null::text, '2026-11-08'::date, '08:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'Tracy Centurions', 'league_game', null::text, null::text),
  ('league:alpha:2026-11-14:12:45:indus dukes', 'alpha', null::text, '2026-11-14'::date, '12:45'::time, 'T20', 'Fremont Central Park', '1110-1166 Stevenson Blvd, Fremont', 'Indus Dukes', 'league_game', null::text, null::text),
  ('league:alpha:2026-11-21:12:45:uc cavs', 'alpha', null::text, '2026-11-21'::date, '12:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'UC Cavs', 'league_game', null::text, null::text),
  ('league:alpha:2027-01-10:12:45:sccc rhinos', 'alpha', null::text, '2027-01-10'::date, '12:45'::time, 'T20', 'Wilson High School', '1840 Benton St, Santa Clara', 'SCCC Rhinos', 'league_game', null::text, null::text),
  ('league:alpha:2027-01-24:12:45:berkeley', 'alpha', null::text, '2027-01-24'::date, '12:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'Berkeley', 'league_game', null::text, null::text),
  ('league:alpha:2027-01-30:12:45:indus avengers', 'alpha', null::text, '2027-01-30'::date, '12:45'::time, 'T20', 'Rancho Milpitas / Sinot Elementary School', '2037 Yellowstone Ave, Milpitas', 'Indus Avengers', 'league_game', null::text, null::text),
  ('league:alpha:2027-02-07:12:45:phoenix dc', 'alpha', null::text, '2027-02-07'::date, '12:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'Phoenix DC', 'league_game', null::text, null::text),
  ('league:alpha:2027-02-20:08:45:uc t20', 'alpha', null::text, '2027-02-20'::date, '08:45'::time, 'T20', 'Seabreeze Park', '32600 Carmel Way, Union City', 'UC T20', 'league_game', null::text, null::text),
  ('league:alpha:2027-02-27:08:45:royal challengers bayarea', 'alpha', null::text, '2027-02-27'::date, '08:45'::time, 'T20', 'East Avenue Middle School', '3600 Pacific Avenue, Livermore', 'Royal Challengers BayArea', 'league_game', null::text, null::text),
  ('league:alpha:2027-03-14:12:45:panthers', 'alpha', null::text, '2027-03-14'::date, '12:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'Panthers', 'league_game', null::text, null::text),
  ('league:alpha:2027-03-27:08:45:bt knights', 'alpha', null::text, '2027-03-27'::date, '08:45'::time, 'T20', 'Birch Grove', '37490 Birch St, Newark', 'BT Knights', 'league_game', null::text, null::text),
  ('league:beta:2026-11-01:08:45:livermore monks', 'beta', null::text, '2026-11-01'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Livermore Monks', 'league_game', null::text, null::text),
  ('league:beta:2026-11-07:12:45:strikers blue 2', 'beta', null::text, '2026-11-07'::date, '12:45'::time, 'T20', 'Taarika Foundation Ground', '1185 Fisher Ave, Morgan Hill', 'Strikers Blue 2', 'league_game', null::text, null::text),
  ('league:beta:2026-11-14:12:45:strong arm', 'beta', null::text, '2026-11-14'::date, '12:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Strong Arm', 'league_game', null::text, null::text),
  ('league:beta:2027-01-09:08:45:gscc bulls', 'beta', null::text, '2027-01-09'::date, '08:45'::time, 'T20', 'East Avenue Middle School', '3600 Pacific Avenue, Livermore, CA', 'GSCC Bulls', 'league_game', null::text, null::text),
  ('league:beta:2027-01-23:08:45:marin bears', 'beta', null::text, '2027-01-23'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Marin Bears', 'league_game', null::text, null::text),
  ('league:beta:2027-01-30:12:45:strong arm', 'beta', null::text, '2027-01-30'::date, '12:45'::time, 'T20', 'Plasencia Fields', '2200 Krohn Road, Tracy', 'Strong Arm', 'league_game', null::text, null::text),
  ('league:beta:2027-02-21:08:45:gscc bulls', 'beta', null::text, '2027-02-21'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'GSCC Bulls', 'league_game', null::text, null::text),
  ('league:beta:2027-02-28:08:45:lathrop dolphins', 'beta', null::text, '2027-02-28'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Lathrop Dolphins', 'league_game', null::text, null::text),
  ('league:beta:2027-03-06:08:45:strikers blue 2', 'beta', null::text, '2027-03-06'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Strikers Blue 2', 'league_game', null::text, null::text),
  ('league:beta:2027-03-14:12:45:marin bears', 'beta', null::text, '2027-03-14'::date, '12:45'::time, 'T20', 'Seabreeze Park', '32600 Carmel Way, Union City', 'Marin Bears', 'league_game', null::text, null::text),
  ('league:beta:2027-03-20:12:45:livermore monks', 'beta', null::text, '2027-03-20'::date, '12:45'::time, 'T20', 'East Avenue Middle School', '3600 Pacific Avenue, Livermore', 'Livermore Monks', 'league_game', null::text, null::text),
  ('league:beta:2027-03-28:08:45:lathrop dolphins', 'beta', null::text, '2027-03-28'::date, '08:45'::time, 'T20', 'Plasencia Fields', '2200 Krohn Road, Tracy', 'Lathrop Dolphins', 'league_game', null::text, null::text),
  ('league:gamma:2026-11-08:08:45:all stars united', 'gamma', null::text, '2026-11-08'::date, '08:45'::time, 'T20', 'Ortega Park', '565-521 Inverness Way, Sunnyvale', 'All Stars United', 'league_game', null::text, null::text),
  ('league:gamma:2026-11-22:08:45:indus conquest', 'gamma', null::text, '2026-11-22'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Indus Conquest', 'league_game', null::text, null::text),
  ('league:gamma:2026-12-06:08:45:ba bca mavericks', 'gamma', null::text, '2026-12-06'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'BA BCA Mavericks', 'league_game', null::text, null::text),
  ('league:gamma:2026-12-13:08:45:bt warriors', 'gamma', null::text, '2026-12-13'::date, '08:45'::time, 'T20', 'East Avenue Middle School', '3600 Pacific Ave, Livermore', 'BT Warriors', 'league_game', null::text, null::text),
  ('league:gamma:2026-12-20:08:45:livermore yodhas', 'gamma', null::text, '2026-12-20'::date, '08:45'::time, 'T20', 'East Avenue Middle School', '3600 Pacific Ave, Livermore', 'Livermore Yodhas', 'league_game', null::text, null::text),
  ('league:gamma:2027-01-23:12:45:strikers white', 'gamma', null::text, '2027-01-23'::date, '12:45'::time, 'T20', 'Taarika Foundation Ground', '1185 Fisher Avneue, Morgan Hill', 'Strikers White', 'league_game', null::text, null::text),
  ('league:gamma:2027-02-06:08:45:valley champions', 'gamma', null::text, '2027-02-06'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Valley Champions', 'league_game', null::text, null::text),
  ('league:gamma:2027-02-20:12:45:bt warriors', 'gamma', null::text, '2027-02-20'::date, '12:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'BT Warriors', 'league_game', null::text, null::text),
  ('league:gamma:2027-02-27:12:45:livermore yodhas', 'gamma', null::text, '2027-02-27'::date, '12:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'Livermore Yodhas', 'league_game', null::text, null::text),
  ('league:gamma:2027-03-07:08:45:indus conquest', 'gamma', null::text, '2027-03-07'::date, '08:45'::time, 'T20', 'Rancho Milpitas / Sinot Elementary School', '2037 Yellowstone Ave, Milpitas', 'Indus Conquest', 'league_game', null::text, null::text),
  ('league:gamma:2027-03-20:08:45:all stars united', 'gamma', null::text, '2027-03-20'::date, '08:45'::time, 'T20', 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward, CA', 'All Stars United', 'league_game', null::text, null::text),
  ('league:gamma:2027-03-27:12:45:ba bca mavericks', 'gamma', null::text, '2027-03-27'::date, '12:45'::time, 'T20', 'Sea Breeze Park', '32600 Carmel Way, Union City', 'BA BCA Mavericks', 'league_game', null::text, null::text),
  ('umpire:8', 'gamma', 'gamma', '2026-11-01'::date, '12:45'::time, null::text, 'Ortega Park', '565-521 Inverness Way, Sunnyvale', 'All Stars United vs Valley Champions', 'umpiring', 'PB-D1', 'Game 8 · Week7 · PB-D1'),
  ('umpire:34', 'gamma', 'gamma', '2026-11-14'::date, '12:45'::time, null::text, 'Ortega Park', '565-521 Inverness Way, Sunnyvale', 'Sunnyvale CC vs Santa Clara Pandas', 'umpiring', 'PB-D2', 'Game 34 · Week10 · PB-D2'),
  ('umpire:49', 'gamma', 'gamma', '2026-11-15'::date, '12:45'::time, null::text, 'Caroline Davis School', '5036 Edenview Dr, San Jose', 'Spartan CC vs SV Lions', 'umpiring', 'PB-D2', 'Game 49 · Week10 · PB-D2'),
  ('umpire:66', 'beta', 'beta', '2026-11-22'::date, '12:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'Panthers vs Indus Dukes', 'umpiring', 'WB-D1', 'Game 66 · Week10 · WB-D1'),
  ('umpire:79', 'alpha', 'alpha', '2026-12-05'::date, '12:45'::time, null::text, 'Fremont Central Park', '1110-1166 Stevenson Blvd, Fremont', 'Indus Avengers vs UC Cavaliers', 'umpiring', 'WB-D1', 'Game 79 · Week10 · WB-D1'),
  ('umpire:88', 'beta', 'beta', '2026-12-06'::date, '12:45'::time, null::text, 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward', 'GSCC Tigers vs Pittsburg Pirates', 'umpiring', 'WB-D2', 'Game 88 · Week10 · WB-D2'),
  ('umpire:92', 'beta', 'beta', '2026-12-12'::date, '08:45'::time, null::text, 'Northgate Park', '34101 Milton St, Fremont', 'Cougars Red vs SV Tigers', 'umpiring', 'WB-D2', 'Game 92 · Week10 · WB-D2'),
  ('umpire:96', 'beta', 'beta', '2026-12-12'::date, '12:45'::time, null::text, 'Northgate Park', '34101 Milton St, Fremont', 'Cougars Black vs BA Knights', 'umpiring', 'WB-D1', 'Game 96 · Week10 · WB-D1'),
  ('umpire:108', 'alpha', 'alpha', '2026-12-13'::date, '12:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'Marin Bears vs Strikers Blue 2', 'umpiring', 'WB-D3', 'Game 108 · Week10 · WB-D3'),
  ('umpire:113', 'alpha', 'alpha', '2026-12-19'::date, '12:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'BA Knights vs Indus Dukes', 'umpiring', 'WB-D1', 'Game 113 · Week10 · WB-D1'),
  ('umpire:140', 'gamma', 'gamma', '2027-01-10'::date, '12:45'::time, null::text, 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward', 'GSCC Thundercats vs Spartan CC', 'umpiring', 'PB-D2', 'Game 140 · Week10 · PB-D2'),
  ('umpire:177', 'gamma', 'gamma', '2027-01-31'::date, '08:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'UC Cubs vs Sunnyvale CC', 'umpiring', 'PB-D2', 'Game 177 · Week10 · PB-D2'),
  ('umpire:186', 'beta', 'beta', '2027-02-06'::date, '08:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'UC T20 vs UC Cavaliers', 'umpiring', 'WB-D1', 'Game 186 · Week10 · WB-D1 · Umpire: Vatsan'),
  ('umpire:191', 'beta', 'beta', '2027-02-06'::date, '12:45'::time, null::text, 'Seabreeze Park', '32600 Carmel Way, Union City', 'BA Knights vs Santa Clara Rhinos', 'umpiring', 'WB-D1', 'Game 191 · Week10 · WB-D1'),
  ('umpire:263', 'alpha', 'alpha', '2027-03-07'::date, '12:45'::time, null::text, 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward', 'GSCC Tigers vs Santa Clara Prospects', 'umpiring', 'WB-D2', 'Game 263 · Week10 · WB-D2'),
  ('umpire:277', 'gamma', 'gamma', '2027-03-14'::date, '12:45'::time, null::text, 'Anthony Ochoa Middle School', '2121 Depot Rd, Hayward', 'GSCC Thundercats vs UC Cubs', 'umpiring', 'PB-D2', 'Game 277 · Week10 · PB-D2'),
  ('umpire:295', 'alpha', 'alpha', '2027-03-21'::date, '08:45'::time, null::text, 'Rancho Milpitas / Sinot Elementary School', '1915 Yellowstone Ave, Milpitas', 'Indus Dukes vs Santa Clara Rhinos', 'umpiring', 'WB-D1', 'Game 295 · Week10 · WB-D1 · Umpire: Ruthvik'),
  ('umpire:301', 'alpha', 'alpha', '2027-03-21'::date, '12:45'::time, null::text, 'Rancho Milpitas / Sinot Elementary School', '1915 Yellowstone Ave, Milpitas', 'Indus Avengers vs Cougars Black', 'umpiring', 'WB-D1', 'Game 301 · Week10 · WB-D1 · Umpire: Ruthvik')

) as v (
  source_key,
  team_slug,
  umpiring_slug,
  game_date,
  start_time,
  match_format,
  ground,
  address,
  opponent,
  event_type,
  division,
  notes
)
join public.teams as side on side.slug = v.team_slug
left join public.teams as umpire on umpire.slug = v.umpiring_slug
on conflict (source_key) do nothing;

do $$
declare
  v_league integer;
  v_umpire integer;
begin
  select count(*) into v_league
  from public.schedule_events
  where event_type = 'league_game' and source_key like 'league:%';

  select count(*) into v_umpire
  from public.schedule_events
  where event_type = 'umpiring' and source_key like 'umpire:%';

  if v_league <> 36 or v_umpire <> 18 then
    raise exception 'schedule seed mismatch: league % umpire %', v_league, v_umpire;
  end if;
end;
$$;
