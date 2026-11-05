-- Let profile and team deletes clear invite foreign keys.
-- The guard trigger otherwise rejects updates that are not a staff revoke
-- or a service-role accept, which blocked ON DELETE SET NULL.

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

  -- ON DELETE SET NULL from profiles or teams updates only the foreign key
  -- and has no request JWT. Allow that cleanup. Any other change still
  -- needs a staff or service-role JWT.
  if tg_op = 'UPDATE'
    and v_jwt_role is null
    and new.id is not distinct from old.id
    and new.email is not distinct from old.email
    and new.token is not distinct from old.token
    and new.role_intended is not distinct from old.role_intended
    and new.status is not distinct from old.status
    and new.expires_at is not distinct from old.expires_at
    and new.created_at is not distinct from old.created_at
    and new.accepted_at is not distinct from old.accepted_at
    and (new.invited_by is not distinct from old.invited_by or new.invited_by is null)
    and (new.team_id is not distinct from old.team_id or new.team_id is null)
    and (new.accepted_user_id is not distinct from old.accepted_user_id or new.accepted_user_id is null)
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

