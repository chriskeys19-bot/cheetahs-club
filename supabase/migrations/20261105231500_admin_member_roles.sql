-- Admin member roles.
--
-- Join links are unchanged: public.handle_new_user() still inserts
-- profiles.role = 'player', and invites.role_intended stays 'player'.
-- Captains can still create those invites.
--
-- Changing profiles.role:
--   * anon and authenticated cannot update the column directly
--   * public.set_member_role() is the browser path (security invoker
--     wrapper around private.set_member_role(), security definer)
--   * profiles_guard_role rejects the change unless the caller is an admin
--     changing someone else, and refuses to remove the last admin
--   * profiles_admin_update lets an admin edit a row. It does not subquery
--     profiles: a profiles policy that reads profiles recurses. The trigger
--     is what makes a role change legal.
--   * Table-level UPDATE includes every column, so revoke update(role) is a
--     no-op while that grant exists. authenticated keeps UPDATE on full_name
--     only. Role changes go through set_member_role().

create or replace function private.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_jwt_role text;
  v_other_admins integer;
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- One role change at a time so the last-admin count cannot race.
  perform pg_catalog.pg_advisory_xact_lock(714209);

  if new.role not in ('player', 'captain', 'admin') then
    raise exception 'invalid role' using errcode = '22023';
  end if;

  v_jwt_role := (select auth.role());

  -- SQL editor and migrations have no request JWT. Trust that path only
  -- when the session user bypasses RLS (postgres, service_role, supabase_admin).
  -- Check session_user, not current_user: this function is security definer,
  -- so current_user is the owner even when a member fired the trigger.
  -- PostgREST's session user is authenticator, which does not bypass RLS,
  -- and its JWT role is set, so a member cannot take this branch.
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

  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  if old.role = 'admin' and new.role is distinct from 'admin' then
    select count(*)::integer
      into v_other_admins
    from public.profiles as p
    where p.role = 'admin'
      and p.id <> old.id;

    if v_other_admins < 1 then
      raise exception 'cannot remove the last admin' using errcode = '42501';
    end if;
  end if;

  if old.id = (select auth.uid()) then
    raise exception 'cannot change your own role' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_profile_role() from public;
revoke all on function private.guard_profile_role() from anon;
revoke all on function private.guard_profile_role() from authenticated;
grant execute on function private.guard_profile_role() to postgres;
grant execute on function private.guard_profile_role() to service_role;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before update of role on public.profiles
  for each row
  execute function private.guard_profile_role();

create or replace function private.set_member_role(target_id uuid, new_role text)
returns table (id uuid, role text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_role text;
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  update public.profiles as p
  set role = new_role
  where p.id = target_id
  returning p.id, p.role
  into v_id, v_role;

  if v_id is null then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  return query
  select v_id, v_role;
end;
$$;

revoke all on function private.set_member_role(uuid, text) from public;
revoke all on function private.set_member_role(uuid, text) from anon;
grant execute on function private.set_member_role(uuid, text) to authenticated;
grant execute on function private.set_member_role(uuid, text) to service_role;

create or replace function public.set_member_role(target_id uuid, new_role text)
returns table (id uuid, role text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select updated.id, updated.role
  from private.set_member_role(target_id, new_role) as updated;
$$;

comment on function public.set_member_role(uuid, text) is
  'Admin changes another member''s club role. The caller cannot change their own role, and the last admin cannot be removed. Join invites still create players.';

revoke all on function public.set_member_role(uuid, text) from public;
revoke all on function public.set_member_role(uuid, text) from anon;
grant execute on function public.set_member_role(uuid, text) to authenticated;
grant execute on function public.set_member_role(uuid, text) to service_role;

create or replace function private.list_club_members()
returns table (id uuid, full_name text, email text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select private.current_role()) is distinct from 'admin' then
    raise exception 'admin role required' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email::text, p.role
  from public.profiles as p
  join auth.users as u on u.id = p.id
  order by
    case p.role
      when 'admin' then 0
      when 'captain' then 1
      else 2
    end,
    lower(coalesce(nullif(btrim(p.full_name), ''), u.email::text, p.id::text));
end;
$$;

revoke all on function private.list_club_members() from public;
revoke all on function private.list_club_members() from anon;
grant execute on function private.list_club_members() to authenticated;
grant execute on function private.list_club_members() to service_role;

create or replace function public.list_club_members()
returns table (id uuid, full_name text, email text, role text)
language sql
stable
security invoker
set search_path = ''
as $$
  select members.id, members.full_name, members.email, members.role
  from private.list_club_members() as members;
$$;

comment on function public.list_club_members() is
  'Admin list of club members with name, email, and role. Email is read from auth.users inside private.list_club_members().';

revoke all on function public.list_club_members() from public;
revoke all on function public.list_club_members() from anon;
grant execute on function public.list_club_members() to authenticated;
grant execute on function public.list_club_members() to service_role;

revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

drop policy if exists profiles_admin_all on public.profiles;
drop policy if exists profiles_admin_insert on public.profiles;
drop policy if exists profiles_admin_delete on public.profiles;
drop policy if exists profiles_admin_update on public.profiles;

create policy profiles_admin_insert on public.profiles
  for insert
  to authenticated
  with check ((select private.current_role()) = 'admin');

create policy profiles_admin_delete on public.profiles
  for delete
  to authenticated
  using ((select private.current_role()) = 'admin');

create policy profiles_admin_update on public.profiles
  for update
  to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

comment on policy profiles_admin_update on public.profiles is
  'Admins can edit a member row. authenticated can update full_name only. Role changes go through set_member_role(), and profiles_guard_role blocks self-changes and removing the last admin.';

notify pgrst, 'reload schema';
