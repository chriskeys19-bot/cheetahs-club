-- Captains and admins can place an existing member on another side.
-- Players cannot insert or delete team_members, so they cannot self-join.
-- accept-invite still assigns the invited side with the service role, which
-- bypasses row level security. New join links stay player-only. This path
-- does not change profiles.role.
--
-- Applied on lutcbvzunjcosncvdyke as version 20261105192141. The version is
-- the clock time of that apply. It sorts before the same-day invite and
-- schedule migrations, and it only needs private.is_staff() from phase 2.

drop policy if exists team_members_write_admin on public.team_members;

create policy team_members_insert_staff
  on public.team_members
  for insert
  to authenticated
  with check ((select private.is_staff()));

comment on policy team_members_insert_staff on public.team_members is
  'Admin and captain can add a membership. Players have no insert policy, so they cannot put themselves on a side.';

create policy team_members_delete_staff
  on public.team_members
  for delete
  to authenticated
  using ((select private.is_staff()));

comment on policy team_members_delete_staff on public.team_members is
  'Admin and captain can remove a membership. Players cannot.';

-- TRUNCATE is not covered by row level security. Take write privileges away
-- from anon. authenticated keeps INSERT and DELETE; the policies decide who
-- succeeds. There is no UPDATE policy: a membership is added or removed.
revoke insert, update, delete, truncate on table public.team_members from anon;
revoke update, truncate on table public.team_members from authenticated;

alter table public.team_members force row level security;

comment on table public.team_members is
  'Which sides a member plays for. Admin and captain add or remove rows. Players can read the list and cannot change it.';

-- Staff roster for Invites. Email stays in auth.users.
-- public.list_team_roster() is security invoker. The private function is
-- security definer and refuses anyone who is not an admin or captain.

create or replace function private.list_team_roster()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  team_ids uuid[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  return query
  select
    p.id,
    p.full_name,
    u.email::text,
    p.role,
    coalesce(
      array_agg(tm.team_id order by t.slug) filter (where tm.team_id is not null),
      '{}'::uuid[]
    ) as team_ids
  from public.profiles as p
  join auth.users as u on u.id = p.id
  left join public.team_members as tm on tm.profile_id = p.id
  left join public.teams as t on t.id = tm.team_id
  group by p.id, p.full_name, u.email, p.role
  order by
    case p.role
      when 'admin' then 0
      when 'captain' then 1
      else 2
    end,
    lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text, p.id::text));
end;
$$;

revoke all on function private.list_team_roster() from public;
revoke all on function private.list_team_roster() from anon;
grant execute on function private.list_team_roster() to authenticated;
grant execute on function private.list_team_roster() to service_role;

create or replace function public.list_team_roster()
returns table (
  id uuid,
  full_name text,
  email text,
  role text,
  team_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select roster.id, roster.full_name, roster.email, roster.role, roster.team_ids
  from private.list_team_roster() as roster;
$$;

comment on function public.list_team_roster() is
  'Admin and captain roster of members with name, email, role, and side ids. Email is read from auth.users inside private.list_team_roster(). Players cannot call it.';

revoke all on function public.list_team_roster() from public;
revoke all on function public.list_team_roster() from anon;
grant execute on function public.list_team_roster() to authenticated;
grant execute on function public.list_team_roster() to service_role;

notify pgrst, 'reload schema';
