-- Move role lookup out of the exposed API schema, and stop anonymous
-- callers from executing the signup trigger function directly.

create or replace function private.current_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles as p
  where p.id = auth.uid();
$$;

revoke all on function private.current_role() from public;
grant execute on function private.current_role() to authenticated;
grant execute on function private.current_role() to service_role;

drop policy if exists teams_write_admin on public.teams;
create policy teams_write_admin on public.teams
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

drop policy if exists profiles_select_own_or_admin on public.profiles;
create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (
    id = (select auth.uid())
    or (select private.current_role()) = 'admin'
  );

drop policy if exists profiles_update_own_name on public.profiles;
create policy profiles_update_own_name on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (
      select p.role from public.profiles as p where p.id = (select auth.uid())
    )
  );

drop policy if exists profiles_admin_all on public.profiles;
create policy profiles_admin_all on public.profiles
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

drop policy if exists team_members_write_admin on public.team_members;
create policy team_members_write_admin on public.team_members
  for all to authenticated
  using ((select private.current_role()) = 'admin')
  with check ((select private.current_role()) = 'admin');

drop policy if exists feedback_select_admin on public.feedback;
create policy feedback_select_admin on public.feedback
  for select to authenticated
  using ((select private.current_role()) = 'admin');

alter table public.feedback force row level security;

drop function public.current_role();

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_new_user() to service_role;
