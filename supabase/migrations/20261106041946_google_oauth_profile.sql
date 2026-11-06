-- Google sign-in still goes through public.handle_new_user().
-- The trigger must not fail when Google omits full_name, and it should
-- keep the Google name and picture when they are present.
-- Role stays player. Metadata cannot grant captain or admin.
--
-- A profile row is not club access by itself. finish-google-signin deletes
-- a Google-only user who has no accepted invite and no email identity, and
-- the sign-in screens stay on "Ask your captain for an invite".

alter table public.profiles
  add column if not exists avatar_url text;

alter table public.profiles
  drop constraint if exists profiles_avatar_url_https;

alter table public.profiles
  add constraint profiles_avatar_url_https check (
    avatar_url is null
    or (
      char_length(avatar_url) between 1 and 2000
      and avatar_url ~ '^https://[^[:space:]]+$'
    )
  );

comment on column public.profiles.avatar_url is
  'Optional https portrait. Google sign-in copies avatar_url or picture. Members cannot edit this column.';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text := coalesce(new.email, '');
  v_name text;
  v_avatar text;
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

  insert into public.profiles (id, full_name, avatar_url, role)
  values (new.id, v_name, v_avatar, 'player');

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates a player profile for every new auth user. Uses Google full_name or name, then the email local-part. Copies an https avatar. Never reads a role from metadata.';

revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;
grant execute on function public.handle_new_user() to service_role;

notify pgrst, 'reload schema';
