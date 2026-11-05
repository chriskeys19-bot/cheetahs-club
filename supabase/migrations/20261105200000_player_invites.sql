-- Player invites. Captains and admins create a single-use join link.
-- The link never grants admin or captain. Accepting it is done by the
-- accept-invite Edge Function with the service role, which creates the
-- auth user. public.handle_new_user() still forces profiles.role = 'player'.
--
-- Players and anon have no select policy, so they cannot list tokens.
-- Staff may read tokens in order to copy the join URL. Email is not sent
-- from the database; the clubhouse shows the link to copy.

create extension if not exists citext with schema extensions;

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  email extensions.citext not null,
  token text not null,
  role_intended text not null default 'player',
  invited_by uuid references public.profiles (id) on delete set null,
  team_id uuid references public.teams (id) on delete set null,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  accepted_user_id uuid references public.profiles (id) on delete set null,
  constraint invites_email_shape check (
    email::text ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(email::text) <= 320
  ),
  constraint invites_email_lower check (email::text = lower(email::text)),
  constraint invites_token_format check (token ~ '^[0-9a-f]{64}$'),
  constraint invites_role_player check (role_intended = 'player'),
  constraint invites_status_check check (
    status in ('pending', 'accepted', 'revoked', 'expired')
  )
);

comment on table public.invites is
  'Single-use player join links. Admin and captain create and revoke them. Tokens are not readable by players.';

comment on column public.invites.token is
  '32 random bytes, hex encoded. Single-use. Staff can read it to share the join link.';

comment on column public.invites.role_intended is
  'Always player. This flow cannot invite an admin or captain.';

create unique index invites_token_key on public.invites (token);

create unique index invites_pending_email_key
  on public.invites (email)
  where status = 'pending';

create index invites_pending_created_idx
  on public.invites (created_at desc)
  where status = 'pending';

create or replace function private.guard_invite()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_jwt_role text;
begin
  v_jwt_role := (select auth.role());

  -- Dashboard SQL as a superuser has no request JWT. Let that path through
  -- so an operator can repair a row. Check constraints still apply.
  -- PostgREST sessions are not superuser, so callers cannot take this branch
  -- by clearing their JWT.
  if v_jwt_role is null
    and exists (
      select 1
      from pg_catalog.pg_roles as r
      where r.rolname = session_user
        and r.rolsuper
    )
  then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (select auth.uid()) is null then
      raise exception 'authentication required' using errcode = '42501';
    end if;
    if not (select private.is_staff()) then
      raise exception 'staff role required' using errcode = '42501';
    end if;

    v_email := lower(btrim(coalesce(new.email::text, '')));
    if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
      or char_length(v_email) > 320
    then
      raise exception 'invalid email' using errcode = '22023';
    end if;

    if exists (
      select 1
      from auth.users as u
      where lower(u.email) = v_email
    ) then
      raise exception 'that email already has a club account' using errcode = '23505';
    end if;

    new.email := v_email;
    new.token := encode(extensions.gen_random_bytes(32), 'hex');
    new.role_intended := 'player';
    new.invited_by := (select auth.uid());
    new.status := 'pending';
    new.expires_at := now() + interval '7 days';
    new.created_at := now();
    new.accepted_at := null;
    new.accepted_user_id := null;
    return new;
  end if;

  if tg_op <> 'UPDATE' then
    raise exception 'unsupported invite change' using errcode = '42501';
  end if;

  if v_jwt_role = 'service_role' then
    if old.status is distinct from 'pending' then
      raise exception 'invite is not pending' using errcode = '42501';
    end if;

    if new.status = 'expired' then
      if old.expires_at > now() then
        raise exception 'invite has not expired' using errcode = '42501';
      end if;
      new.id := old.id;
      new.email := old.email;
      new.token := old.token;
      new.role_intended := old.role_intended;
      new.invited_by := old.invited_by;
      new.team_id := old.team_id;
      new.expires_at := old.expires_at;
      new.created_at := old.created_at;
      new.accepted_at := old.accepted_at;
      new.accepted_user_id := old.accepted_user_id;
      new.status := 'expired';
      return new;
    end if;

    if new.status is distinct from 'accepted' then
      raise exception 'invalid invite transition' using errcode = '42501';
    end if;
    if old.expires_at <= now() then
      raise exception 'invite has expired' using errcode = '42501';
    end if;
    if new.accepted_user_id is null then
      raise exception 'accepted user required' using errcode = '23502';
    end if;
    if old.role_intended is distinct from 'player' then
      raise exception 'invite role must be player' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from auth.users as u
      where u.id = new.accepted_user_id
        and lower(u.email) = lower(old.email::text)
    ) then
      raise exception 'accepted user does not match invite email' using errcode = '42501';
    end if;
    if not exists (
      select 1
      from public.profiles as p
      where p.id = new.accepted_user_id
        and p.role = 'player'
    ) then
      raise exception 'accepted profile must be a player' using errcode = '42501';
    end if;

    new.id := old.id;
    new.email := old.email;
    new.token := old.token;
    new.role_intended := 'player';
    new.invited_by := old.invited_by;
    new.team_id := old.team_id;
    new.expires_at := old.expires_at;
    new.created_at := old.created_at;
    new.status := 'accepted';
    new.accepted_at := now();
    return new;
  end if;

  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if old.status is distinct from 'pending' then
    raise exception 'only pending invites can be revoked' using errcode = '42501';
  end if;
  if new.status is distinct from 'revoked' then
    raise exception 'invites can only be revoked' using errcode = '42501';
  end if;

  new.id := old.id;
  new.email := old.email;
  new.token := old.token;
  new.role_intended := old.role_intended;
  new.invited_by := old.invited_by;
  new.team_id := old.team_id;
  new.expires_at := old.expires_at;
  new.created_at := old.created_at;
  new.accepted_at := old.accepted_at;
  new.accepted_user_id := old.accepted_user_id;
  new.status := 'revoked';
  return new;
end;
$$;

revoke all on function private.guard_invite() from public;
revoke all on function private.guard_invite() from anon;
revoke all on function private.guard_invite() from authenticated;
grant execute on function private.guard_invite() to authenticated;
grant execute on function private.guard_invite() to service_role;

create trigger invites_guard
  before insert or update on public.invites
  for each row
  execute function private.guard_invite();

alter table public.invites enable row level security;
alter table public.invites force row level security;

revoke all on table public.invites from public;
revoke all on table public.invites from anon;
revoke all on table public.invites from authenticated;
revoke all on table public.invites from service_role;

grant select on table public.invites to authenticated;
grant insert (email, team_id) on table public.invites to authenticated;
grant update (status) on table public.invites to authenticated;
grant select, insert, update on table public.invites to service_role;

create policy invites_select_staff
  on public.invites
  for select
  to authenticated
  using ((select private.is_staff()));

create policy invites_insert_staff
  on public.invites
  for insert
  to authenticated
  with check ((select private.is_staff()));

create policy invites_revoke_staff
  on public.invites
  for update
  to authenticated
  using (
    (select private.is_staff())
    and status = 'pending'
  )
  with check (
    (select private.is_staff())
    and status = 'revoked'
  );

notify pgrst, 'reload schema';
