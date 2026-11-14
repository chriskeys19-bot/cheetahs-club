-- Public access requests.
--
-- /signup creates an auth user and a pending request. Until a captain or
-- admin approves it, profiles.access_status stays 'pending' and the member
-- cannot read club data. Row level security enforces that. The pending
-- screen in the app is only a hint.
--
-- Existing members are marked active when the column is added. The default
-- then changes to pending so a later insert does not inherit access.
-- Invite acceptance is the exception: accept-invite sets
-- auth.users.raw_app_meta_data.access = 'active' before the row exists.
-- That claim is not user-editable. user metadata is ignored for access.
--
-- Deploy the updated accept-invite and finish-google-signin functions
-- before or with this migration. An old invite function does not set
-- app metadata, so a join link opened after this file is applied would
-- create a pending player until those functions are deployed.

alter table public.profiles
  add column access_status text not null default 'active'
  constraint profiles_access_status_check check (access_status in ('pending', 'active'));

comment on column public.profiles.access_status is
  'active members can read club data. pending accounts are waiting on an access request. Invite signup sets active through app metadata, which the user cannot edit.';

alter table public.profiles
  alter column access_status set default 'pending';

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = (select auth.uid())
    and p.access_status = 'active';
$$;

comment on function private.current_role() is
  'Club role for an active member. Pending accounts have no role here, so staff checks fail closed until an access request is approved.';

revoke all on function private.current_role() from public;
revoke all on function private.current_role() from anon;
revoke all on function private.current_role() from authenticated;
grant execute on function private.current_role() to authenticated;
grant execute on function private.current_role() to service_role;

create or replace function private.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = (select auth.uid())
      and p.access_status = 'active'
  );
$$;

comment on function private.is_active_member() is
  'True only after approval or an invite. Restrictive policies on club tables call this so a pending account cannot read or write club data.';

revoke all on function private.is_active_member() from public;
revoke all on function private.is_active_member() from anon;
revoke all on function private.is_active_member() from authenticated;
grant execute on function private.is_active_member() to authenticated;
grant execute on function private.is_active_member() to service_role;

-- Club tables keep their existing permissive policies. This adds one
-- restrictive policy on each, which Postgres ANDs with those policies.
-- Pending accounts fail it. Active members are unchanged. profiles and
-- teams are not in the list: a pending account must read its own profile,
-- and team names are public on /signup.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'announcements',
    'activities',
    'schedule_events',
    'polls',
    'poll_options',
    'poll_votes',
    'expenses',
    'dues_assessments',
    'dues_payments',
    'feedback',
    'team_members',
    'invites',
    'password_reset_audit',
    'splitwise_meta',
    'splitwise_status',
    'splitwise_balances',
    'splitwise_expenses',
    'splitwise_shares',
    'splitwise_debts',
    'splitwise_membership',
    'stream_keys',
    'game_streams',
    'stream_jobs'
  ]
  loop
    execute format('drop policy if exists active_member_only on public.%I', v_table);
    execute format(
      'create policy active_member_only on public.%I as restrictive for all to authenticated using ((select private.is_active_member())) with check ((select private.is_active_member()))',
      v_table
    );
  end loop;
end
$$;

create or replace function private.poll_tallies()
returns table (poll_id uuid, option_id uuid, votes integer)
language sql
stable
security definer
set search_path = ''
as $$
  select v.poll_id, v.option_id, count(*)::integer
  from public.poll_votes as v
  where (select private.is_active_member())
  group by v.poll_id, v.option_id;
$$;

revoke all on function private.poll_tallies() from public;
revoke all on function private.poll_tallies() from anon;
grant execute on function private.poll_tallies() to authenticated;
grant execute on function private.poll_tallies() to service_role;

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
      and (p.closes_at is null or p.closes_at > pg_catalog.now())
      and (select private.is_active_member())
  );
$$;

revoke all on function private.poll_is_open(uuid) from public;
revoke all on function private.poll_is_open(uuid) from anon;
grant execute on function private.poll_is_open(uuid) to authenticated;
grant execute on function private.poll_is_open(uuid) to service_role;

create or replace function public.request_stream_job(
  p_schedule_event_id uuid,
  p_action text,
  p_payload jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if coalesce((select private.is_active_member()), false) is not true then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;
  return private.request_stream_job(p_schedule_event_id, p_action, p_payload);
end;
$$;

comment on function public.request_stream_job(uuid, text, jsonb) is
  'Queues one stream job after checking the game, the action, and any open job. The caller must be an active member. Pending access requests are refused. A create can be retried from checking or creating when no fresh job is open and no YouTube video was saved. A job older than 7 minutes is failed first so Retry enqueues a new one. Ending a stream before the game is completed is limited to captains and admins. A completed game can still be ended by any active member.';

revoke all on function public.request_stream_job(uuid, text, jsonb) from public;
revoke all on function public.request_stream_job(uuid, text, jsonb) from anon;
grant execute on function public.request_stream_job(uuid, text, jsonb) to authenticated;
grant execute on function public.request_stream_job(uuid, text, jsonb) to service_role;

create or replace function public.link_existing_stream(
  p_schedule_event_id uuid,
  p_youtube_url text
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if coalesce((select private.is_active_member()), false) is not true then
    raise exception 'Sign in again, then try the stream.' using errcode = '42501';
  end if;
  return private.link_existing_stream(p_schedule_event_id, p_youtube_url);
end;
$$;

comment on function public.link_existing_stream(uuid, text) is
  'Save a YouTube link for a game that has no stream yet. The caller must be an active member.';

revoke all on function public.link_existing_stream(uuid, text) from public;
revoke all on function public.link_existing_stream(uuid, text) from anon;
grant execute on function public.link_existing_stream(uuid, text) to authenticated;
grant execute on function public.link_existing_stream(uuid, text) to service_role;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_app jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  v_email text := coalesce(new.email, '');
  v_name text;
  v_avatar text;
  v_access text := 'pending';
begin
  v_name := nullif(
    btrim(
      regexp_replace(
        coalesce(nullif(btrim(v_meta->>'full_name'), ''), nullif(btrim(v_meta->>'name'), ''), ''),
        '[[:cntrl:]]+',
        ' ',
        'g'
      )
    ),
    ''
  );
  if v_name is null then
    v_name := nullif(btrim(split_part(v_email, '@', 1)), '');
  end if;
  if v_name is null then
    v_name := 'Player';
  end if;
  if char_length(v_name) > 80 then
    v_name := btrim(left(v_name, 80));
  end if;
  if v_name is null or char_length(v_name) = 0 then
    v_name := 'Player';
  end if;

  v_avatar := nullif(btrim(coalesce(v_meta->>'avatar_url', v_meta->>'picture', '')), '');
  if v_avatar is null
    or char_length(v_avatar) > 2000
    or v_avatar !~ '^https://[^[:space:]]+$'
  then
    v_avatar := null;
  end if;

  -- raw_app_meta_data is service-role only. Invite signup sets access=active.
  -- A public signup cannot set this claim, so it stays pending.
  if v_app->>'access' = 'active' then
    v_access := 'active';
  end if;

  insert into public.profiles (id, full_name, avatar_url, role, access_status)
  values (new.id, v_name, v_avatar, 'player', v_access);

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates a player profile for every new auth user. Access stays pending unless raw_app_meta_data.access is active. Never reads a role or an access flag from user metadata.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_new_user() to service_role;

create or replace function private.guard_profile_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text;
begin
  if new.access_status is not distinct from old.access_status then
    return new;
  end if;

  if new.access_status not in ('pending', 'active') then
    raise exception 'invalid access status' using errcode = '22023';
  end if;

  v_jwt_role := (select auth.role());

  if v_jwt_role is null
    and exists (
      select 1
      from pg_catalog.pg_roles as r
      where r.rolname = session_user
        and (r.rolsuper or r.rolbypassrls)
    )
  then
    return new;
  end if;

  if v_jwt_role = 'service_role' then
    return new;
  end if;

  -- private.approve_access_request sets this for the current transaction
  -- after it has checked the caller. PostgREST does not expose set_config.
  if pg_catalog.current_setting('access.approving', true) = '1'
    and (select private.is_active_member())
    and (select private.current_role()) in ('admin', 'captain')
    and new.access_status = 'active'
  then
    return new;
  end if;

  raise exception 'access status cannot be changed' using errcode = '42501';
end;
$$;

revoke all on function private.guard_profile_access() from public;
revoke all on function private.guard_profile_access() from anon;
revoke all on function private.guard_profile_access() from authenticated;
grant execute on function private.guard_profile_access() to postgres;
grant execute on function private.guard_profile_access() to service_role;

drop trigger if exists profiles_guard_access on public.profiles;
create trigger profiles_guard_access
  before update of access_status on public.profiles
  for each row
  execute function private.guard_profile_access();

create table public.access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  note text,
  status text not null default 'pending',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  assigned_team_id uuid references public.teams (id) on delete set null,
  assigned_role text,
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  requester_notified_at timestamptz,
  constraint access_requests_note_length check (note is null or char_length(note) between 1 and 500),
  constraint access_requests_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint access_requests_assigned_role_check check (
    assigned_role is null or assigned_role in ('player', 'captain')
  ),
  constraint access_requests_decision_check check (
    (status = 'pending' and decided_at is null and assigned_team_id is null and assigned_role is null)
    or (status = 'approved' and decided_at is not null and assigned_team_id is not null and assigned_role is not null)
    or (status = 'rejected' and decided_at is not null and assigned_team_id is null and assigned_role is null)
  )
);

comment on table public.access_requests is
  'One row per person who asked to join from /signup. Pending until a captain of a requested side, or an admin, approves or rejects it.';

comment on column public.access_requests.note is
  'Optional note from the person requesting access. At most 500 characters.';

comment on column public.access_requests.notified_at is
  'When the approver email was accepted, or claimed while that send is in flight. Null means the in-app queue is the notice.';

create index access_requests_pending_idx
  on public.access_requests (created_at desc)
  where status = 'pending';

create index access_requests_decided_by_idx
  on public.access_requests (decided_by);

create index access_requests_assigned_team_idx
  on public.access_requests (assigned_team_id);

create table public.access_request_teams (
  request_id uuid not null references public.access_requests (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete restrict,
  primary key (request_id, team_id)
);

comment on table public.access_request_teams is
  'Sides the person asked to join. Approval assigns one side, which can differ from this list when an admin changes it.';

create index access_request_teams_team_idx
  on public.access_request_teams (team_id);

alter table public.access_requests enable row level security;
alter table public.access_requests force row level security;
alter table public.access_request_teams enable row level security;
alter table public.access_request_teams force row level security;

revoke all on table public.access_requests from public;
revoke all on table public.access_requests from anon;
revoke all on table public.access_requests from authenticated;
grant select on table public.access_requests to authenticated;
grant select, insert, update, delete on table public.access_requests to service_role;

revoke all on table public.access_request_teams from public;
revoke all on table public.access_request_teams from anon;
revoke all on table public.access_request_teams from authenticated;
grant select on table public.access_request_teams to authenticated;
grant select, insert, update, delete on table public.access_request_teams to service_role;

create policy access_requests_select_own
  on public.access_requests
  for select
  to authenticated
  using (user_id = (select auth.uid()));

comment on policy access_requests_select_own on public.access_requests is
  'A person can read their own request, including while it is pending.';

create policy access_requests_select_staff
  on public.access_requests
  for select
  to authenticated
  using (
    (select private.is_active_member())
    and (
      (select private.current_role()) = 'admin'
      or (
        (select private.current_role()) = 'captain'
        and exists (
          select 1
          from public.access_request_teams as art
          join public.team_members as tm
            on tm.team_id = art.team_id
           and tm.profile_id = (select auth.uid())
          where art.request_id = access_requests.id
        )
      )
    )
  );

comment on policy access_requests_select_staff on public.access_requests is
  'Admins read every request. Captains read a request only when it asks for one of their sides. Writes go through the access RPCs.';

create policy access_request_teams_select_own
  on public.access_request_teams
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.access_requests as r
      where r.id = access_request_teams.request_id
        and r.user_id = (select auth.uid())
    )
  );

create policy access_request_teams_select_staff
  on public.access_request_teams
  for select
  to authenticated
  using (
    (select private.is_active_member())
    and (
      (select private.current_role()) = 'admin'
      or (
        (select private.current_role()) = 'captain'
        and exists (
          select 1
          from public.access_request_teams as mine
          join public.team_members as tm
            on tm.team_id = mine.team_id
           and tm.profile_id = (select auth.uid())
          where mine.request_id = access_request_teams.request_id
        )
      )
    )
  );

revoke all on table public.teams from anon;
grant select (id, name, slug) on table public.teams to anon;

create policy teams_select_anon
  on public.teams
  for select
  to anon
  using (true);

comment on policy teams_select_anon on public.teams is
  'Team names are public so /signup can list Alpha, Beta, and Gamma before anyone signs in.';

create or replace function private.create_access_request(
  p_user_id uuid,
  p_note text,
  p_team_ids uuid[]
)
returns table (id uuid, created boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text;
  v_ids uuid[];
  v_new uuid;
  v_existing uuid;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'account is not waiting for access' using errcode = '42501';
  end if;

  select r.id
    into v_existing
  from public.access_requests as r
  where r.user_id = p_user_id;

  if v_existing is not null then
    return query
    select v_existing, false;
    return;
  end if;

  if not exists (
    select 1
    from public.profiles as p
    where p.id = p_user_id
      and p.access_status = 'pending'
  ) then
    raise exception 'account is not waiting for access' using errcode = '42501';
  end if;

  if p_team_ids is null or cardinality(p_team_ids) < 1 or cardinality(p_team_ids) > 8 then
    raise exception 'choose a side' using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(p_team_ids) as requested (team_id)
    where requested.team_id is null
  ) then
    raise exception 'choose a side' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct t.id), '{}'::uuid[])
    into v_ids
  from public.teams as t
  where t.id = any (p_team_ids);

  if cardinality(v_ids) < 1
    or cardinality(v_ids) <> (
      select count(distinct team_id)::integer
      from unnest(p_team_ids) as requested (team_id)
    )
  then
    raise exception 'choose a side' using errcode = '22023';
  end if;

  v_note := nullif(pg_catalog.btrim(coalesce(p_note, '')), '');
  if v_note is not null then
    v_note := nullif(pg_catalog.btrim(pg_catalog.regexp_replace(v_note, '[[:cntrl:]]', ' ', 'g')), '');
  end if;
  if v_note is not null and pg_catalog.char_length(v_note) > 500 then
    raise exception 'note is too long' using errcode = '22023';
  end if;

  begin
    insert into public.access_requests (user_id, note)
    values (p_user_id, v_note)
    returning access_requests.id into v_new;
  exception
    when unique_violation then
      select r.id
        into v_existing
      from public.access_requests as r
      where r.user_id = p_user_id;
      return query
      select v_existing, false;
      return;
  end;

  insert into public.access_request_teams (request_id, team_id)
  select v_new, team_id
  from unnest(v_ids) as requested (team_id);

  return query
  select v_new, true;
end;
$$;

comment on function private.create_access_request(uuid, text, uuid[]) is
  'Service role records one pending request for a pending profile. A second call returns the existing row and does not change it.';

revoke all on function private.create_access_request(uuid, text, uuid[]) from public;
revoke all on function private.create_access_request(uuid, text, uuid[]) from anon;
revoke all on function private.create_access_request(uuid, text, uuid[]) from authenticated;
grant execute on function private.create_access_request(uuid, text, uuid[]) to service_role;

create or replace function public.create_access_request(
  p_user_id uuid,
  p_note text,
  p_team_ids uuid[]
)
returns table (id uuid, created boolean)
language sql
volatile
security invoker
set search_path = ''
as $$
  select created_request.id, created_request.created
  from private.create_access_request(p_user_id, p_note, p_team_ids) as created_request;
$$;

comment on function public.create_access_request(uuid, text, uuid[]) is
  'Service role only. Records the sides and optional note for a pending account.';

revoke all on function public.create_access_request(uuid, text, uuid[]) from public;
revoke all on function public.create_access_request(uuid, text, uuid[]) from anon;
revoke all on function public.create_access_request(uuid, text, uuid[]) from authenticated;
grant execute on function public.create_access_request(uuid, text, uuid[]) to service_role;

create or replace function private.request_visible_to_caller(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.access_requests as r
    where r.id = p_request_id
      and (
        (select private.current_role()) = 'admin'
        or (
          (select private.current_role()) = 'captain'
          and exists (
            select 1
            from public.access_request_teams as art
            join public.team_members as tm
              on tm.team_id = art.team_id
             and tm.profile_id = (select auth.uid())
            where art.request_id = r.id
          )
        )
      )
  );
$$;

revoke all on function private.request_visible_to_caller(uuid) from public;
revoke all on function private.request_visible_to_caller(uuid) from anon;
revoke all on function private.request_visible_to_caller(uuid) from authenticated;
grant execute on function private.request_visible_to_caller(uuid) to service_role;

create or replace function private.list_access_requests()
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  email text,
  note text,
  status text,
  created_at timestamptz,
  requested_team_ids uuid[],
  requested_team_names text[],
  assignable_team_ids uuid[],
  assignable_team_names text[],
  can_set_role boolean,
  decided_at timestamptz,
  assigned_team_id uuid,
  assigned_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text := (select private.current_role());
  v_assign_ids uuid[];
  v_assign_names text[];
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role is distinct from 'admin' and v_role is distinct from 'captain' then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  if v_role = 'admin' then
    select
      coalesce(array_agg(t.id order by t.slug), '{}'::uuid[]),
      coalesce(array_agg(t.name order by t.slug), '{}'::text[])
      into v_assign_ids, v_assign_names
    from public.teams as t;
  else
    select
      coalesce(array_agg(t.id order by t.slug), '{}'::uuid[]),
      coalesce(array_agg(t.name order by t.slug), '{}'::text[])
      into v_assign_ids, v_assign_names
    from public.team_members as tm
    join public.teams as t on t.id = tm.team_id
    where tm.profile_id = v_uid;
  end if;

  return query
  select
    r.id,
    r.user_id,
    p.full_name,
    u.email::text,
    r.note,
    r.status,
    r.created_at,
    requested.ids,
    requested.names,
    v_assign_ids,
    v_assign_names,
    v_role = 'admin',
    r.decided_at,
    r.assigned_team_id,
    r.assigned_role
  from public.access_requests as r
  join public.profiles as p on p.id = r.user_id
  join auth.users as u on u.id = r.user_id
  cross join lateral (
    select
      coalesce(array_agg(t.id order by t.slug), '{}'::uuid[]) as ids,
      coalesce(array_agg(t.name order by t.slug), '{}'::text[]) as names
    from public.access_request_teams as art
    join public.teams as t on t.id = art.team_id
    where art.request_id = r.id
  ) as requested
  where private.request_visible_to_caller(r.id)
    and (
      r.status = 'pending'
      or r.decided_at > pg_catalog.now() - interval '30 days'
    )
  order by
    case when r.status = 'pending' then 0 else 1 end,
    r.created_at desc;
end;
$$;

comment on function private.list_access_requests() is
  'Active admins see every request. Active captains see a request only when it includes one of their sides. Email comes from auth.users.';

revoke all on function private.list_access_requests() from public;
revoke all on function private.list_access_requests() from anon;
grant execute on function private.list_access_requests() to authenticated;
grant execute on function private.list_access_requests() to service_role;

create or replace function public.list_access_requests()
returns table (
  id uuid,
  user_id uuid,
  full_name text,
  email text,
  note text,
  status text,
  created_at timestamptz,
  requested_team_ids uuid[],
  requested_team_names text[],
  assignable_team_ids uuid[],
  assignable_team_names text[],
  can_set_role boolean,
  decided_at timestamptz,
  assigned_team_id uuid,
  assigned_role text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    requests.id,
    requests.user_id,
    requests.full_name,
    requests.email,
    requests.note,
    requests.status,
    requests.created_at,
    requests.requested_team_ids,
    requests.requested_team_names,
    requests.assignable_team_ids,
    requests.assignable_team_names,
    requests.can_set_role,
    requests.decided_at,
    requests.assigned_team_id,
    requests.assigned_role
  from private.list_access_requests() as requests;
$$;

comment on function public.list_access_requests() is
  'Access queue for an active admin or captain. Captains only receive requests that ask for one of their sides.';

revoke all on function public.list_access_requests() from public;
revoke all on function public.list_access_requests() from anon;
grant execute on function public.list_access_requests() to authenticated;
grant execute on function public.list_access_requests() to service_role;

create or replace function private.pending_access_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.access_requests as r
  where r.status = 'pending'
    and (select private.current_role()) in ('admin', 'captain')
    and private.request_visible_to_caller(r.id);
$$;

revoke all on function private.pending_access_count() from public;
revoke all on function private.pending_access_count() from anon;
grant execute on function private.pending_access_count() to authenticated;
grant execute on function private.pending_access_count() to service_role;

create or replace function public.pending_access_count()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select private.pending_access_count();
$$;

comment on function public.pending_access_count() is
  'How many pending requests the signed-in admin or captain can act on. Anyone else gets zero.';

revoke all on function public.pending_access_count() from public;
revoke all on function public.pending_access_count() from anon;
grant execute on function public.pending_access_count() to authenticated;
grant execute on function public.pending_access_count() to service_role;

create or replace function private.approve_access_request(
  p_request_id uuid,
  p_team_id uuid,
  p_role text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller text := (select private.current_role());
  v_user uuid;
  v_status text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_caller is distinct from 'admin' and v_caller is distinct from 'captain' then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  v_role := coalesce(nullif(pg_catalog.btrim(coalesce(p_role, '')), ''), 'player');
  if v_role not in ('player', 'captain') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if v_caller = 'captain' and v_role is distinct from 'player' then
    raise exception 'captains can only approve players' using errcode = '42501';
  end if;

  if p_team_id is null or not exists (select 1 from public.teams as t where t.id = p_team_id) then
    raise exception 'choose a side' using errcode = '22023';
  end if;

  select r.user_id, r.status
    into v_user, v_status
  from public.access_requests as r
  where r.id = p_request_id
  for update;

  if v_user is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'request is not pending' using errcode = '42501';
  end if;
  if v_user = v_uid then
    raise exception 'cannot approve your own request' using errcode = '42501';
  end if;

  if v_caller = 'captain' then
    if not exists (
      select 1
      from public.team_members as tm
      where tm.profile_id = v_uid
        and tm.team_id = p_team_id
    ) then
      raise exception 'captains can only approve their own sides' using errcode = '42501';
    end if;
    if not private.request_visible_to_caller(p_request_id) then
      raise exception 'captains can only approve requests for their own sides' using errcode = '42501';
    end if;
  end if;

  perform pg_catalog.set_config('access.approving', '1', true);

  if v_caller = 'admin' and v_role is distinct from (
    select p.role from public.profiles as p where p.id = v_user
  ) then
    update public.profiles as p
    set access_status = 'active',
        role = v_role
    where p.id = v_user;
  else
    update public.profiles as p
    set access_status = 'active'
    where p.id = v_user;
  end if;

  insert into public.team_members (team_id, profile_id)
  values (p_team_id, v_user)
  on conflict do nothing;

  update public.access_requests as r
  set status = 'approved',
      decided_by = v_uid,
      decided_at = pg_catalog.now(),
      assigned_team_id = p_team_id,
      assigned_role = v_role
  where r.id = p_request_id
    and r.status = 'pending';

  return p_request_id;
end;
$$;

comment on function private.approve_access_request(uuid, uuid, text) is
  'An active admin can approve any request onto any side as player or captain. An active captain can approve only a request that includes one of their sides, and only onto a side they belong to, as a player.';

revoke all on function private.approve_access_request(uuid, uuid, text) from public;
revoke all on function private.approve_access_request(uuid, uuid, text) from anon;
grant execute on function private.approve_access_request(uuid, uuid, text) to authenticated;
grant execute on function private.approve_access_request(uuid, uuid, text) to service_role;

create or replace function public.approve_access_request(
  p_request_id uuid,
  p_team_id uuid,
  p_role text
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.approve_access_request(p_request_id, p_team_id, p_role);
$$;

comment on function public.approve_access_request(uuid, uuid, text) is
  'Approve a pending access request. Admins choose the side and player or captain. Captains choose one of their own sides and the role stays player.';

revoke all on function public.approve_access_request(uuid, uuid, text) from public;
revoke all on function public.approve_access_request(uuid, uuid, text) from anon;
grant execute on function public.approve_access_request(uuid, uuid, text) to authenticated;
grant execute on function public.approve_access_request(uuid, uuid, text) to service_role;

create or replace function private.reject_access_request(p_request_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller text := (select private.current_role());
  v_user uuid;
  v_status text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_caller is distinct from 'admin' and v_caller is distinct from 'captain' then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  select r.user_id, r.status
    into v_user, v_status
  from public.access_requests as r
  where r.id = p_request_id
  for update;

  if v_user is null then
    raise exception 'request not found' using errcode = 'P0002';
  end if;
  if v_status is distinct from 'pending' then
    raise exception 'request is not pending' using errcode = '42501';
  end if;
  if v_user = v_uid then
    raise exception 'cannot reject your own request' using errcode = '42501';
  end if;
  if v_caller = 'captain' and not private.request_visible_to_caller(p_request_id) then
    raise exception 'captains can only reject requests for their own sides' using errcode = '42501';
  end if;

  update public.access_requests as r
  set status = 'rejected',
      decided_by = v_uid,
      decided_at = pg_catalog.now()
  where r.id = p_request_id
    and r.status = 'pending';

  return p_request_id;
end;
$$;

comment on function private.reject_access_request(uuid) is
  'Reject a pending request. The profile stays pending, so club data stays hidden. Admins can reject any request. Captains can reject a request that includes one of their sides. That closes the whole request, including other sides on it.';

revoke all on function private.reject_access_request(uuid) from public;
revoke all on function private.reject_access_request(uuid) from anon;
grant execute on function private.reject_access_request(uuid) to authenticated;
grant execute on function private.reject_access_request(uuid) to service_role;

create or replace function public.reject_access_request(p_request_id uuid)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.reject_access_request(p_request_id);
$$;

comment on function public.reject_access_request(uuid) is
  'Reject a pending access request. The person stays signed in and still cannot see club data.';

revoke all on function public.reject_access_request(uuid) from public;
revoke all on function public.reject_access_request(uuid) from anon;
grant execute on function public.reject_access_request(uuid) to authenticated;
grant execute on function public.reject_access_request(uuid) to service_role;

notify pgrst, 'reload schema';
