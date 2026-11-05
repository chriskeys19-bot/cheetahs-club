-- Let a member update their own name without a profiles policy reading profiles.
-- The previous WITH CHECK subquery recursed. private.profile_role_is() is
-- security definer, so the role still has to stay the same on a self-update.

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
