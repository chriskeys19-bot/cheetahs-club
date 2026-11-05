-- Repair admin_member_roles.
--
-- The first version of profiles_admin_update read public.profiles from
-- inside a policy on public.profiles, which Postgres rejects as infinite
-- recursion. Role rules stay in profiles_guard_role instead.
--
-- revoke update(role) does not pierce a table-level UPDATE grant. Replace
-- that grant with UPDATE on full_name only so the browser cannot set role.

drop policy if exists profiles_admin_update on public.profiles;

create policy profiles_admin_update on public.profiles
  for update
  to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

comment on policy profiles_admin_update on public.profiles is
  'Admins can edit a member row. authenticated can update full_name only. Role changes go through set_member_role(), and profiles_guard_role blocks self-changes and removing the last admin.';

revoke update on table public.profiles from public;
revoke update on table public.profiles from anon;
revoke update on table public.profiles from authenticated;
grant update (full_name) on table public.profiles to authenticated;

-- profiles_update_own_name compared the new role to a subquery on profiles.
-- A policy that reads its own table recurses, so a member could not save
-- their name. Ask a security definer function instead. The column grant
-- already stops authenticated from writing profiles.role.
create or replace function private.profile_role_is(target uuid, expected text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles as p
    where p.id = target
      and p.role = expected
  );
$$;

revoke all on function private.profile_role_is(uuid, text) from public;
revoke all on function private.profile_role_is(uuid, text) from anon;
grant execute on function private.profile_role_is(uuid, text) to authenticated;
grant execute on function private.profile_role_is(uuid, text) to service_role;

drop policy if exists profiles_update_own_name on public.profiles;
create policy profiles_update_own_name on public.profiles
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and private.profile_role_is(id, role)
  );

notify pgrst, 'reload schema';
