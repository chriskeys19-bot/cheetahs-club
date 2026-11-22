-- YouTube OAuth for the staff Streams page.
--
-- The refresh token for the CricketCrazeUSA channel stays in private
-- tables. Row level security is on and forced, and there are no policies,
-- so anon and authenticated cannot read them. The public functions below
-- are granted only to service_role and refuse every other role, including
-- a signed-in admin. Edge Functions call them with the service role.
--
-- Apply this file on project lutcbvzunjcosncvdyke. The Cloudflare Pages
-- deploy does not run SQL. Deploy the Edge Functions after it is applied.
--
-- youtube_broadcast_apply records a done end job only when the caller
-- sets p_confirm_end. The Edge Function sets that after YouTube
-- liveBroadcasts.transition to complete has been confirmed. A pending end
-- job is marked done so the bot does not end a broadcast that already
-- stopped. A running end job is left for the bot. Setup statuses and open
-- jobs are not overwritten when a broadcast goes live.

create table private.youtube_connections (
  id smallint primary key default 1,
  refresh_token text not null,
  channel_id text,
  channel_title text,
  connected_by uuid,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  token_error text,
  constraint youtube_connections_singleton check (id = 1),
  constraint youtube_connections_refresh_len check (char_length(refresh_token) between 20 and 4096),
  constraint youtube_connections_channel_id_len check (
    channel_id is null or char_length(btrim(channel_id)) between 1 and 128
  ),
  constraint youtube_connections_title_len check (
    channel_title is null or char_length(btrim(channel_title)) between 1 and 200
  ),
  constraint youtube_connections_error_len check (
    token_error is null or char_length(btrim(token_error)) between 1 and 300
  )
);

comment on table private.youtube_connections is
  'One YouTube refresh token for the club channel. Service role only. Google Testing refresh tokens expire after 7 days until the consent screen is published to Production.';

comment on column private.youtube_connections.token_error is
  'Set when Google rejects the refresh token (invalid_grant). Cleared on a successful refresh or reconnect. Never shown with the token.';

create table private.youtube_oauth_states (
  nonce_hash text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint youtube_oauth_states_hash_check check (nonce_hash ~ '^[0-9a-f]{64}$'),
  constraint youtube_oauth_states_user_check check (user_id is not null)
);

comment on table private.youtube_oauth_states is
  'Single-use hashes for the YouTube OAuth state parameter. The raw state is an HMAC signed by the Edge Function and is not stored.';

alter table private.youtube_connections enable row level security;
alter table private.youtube_connections force row level security;
alter table private.youtube_oauth_states enable row level security;
alter table private.youtube_oauth_states force row level security;

revoke all on table private.youtube_connections from public;
revoke all on table private.youtube_connections from anon;
revoke all on table private.youtube_connections from authenticated;
grant select, insert, update, delete on table private.youtube_connections to service_role;

revoke all on table private.youtube_oauth_states from public;
revoke all on table private.youtube_oauth_states from anon;
revoke all on table private.youtube_oauth_states from authenticated;
grant select, insert, update, delete on table private.youtube_oauth_states to service_role;

create or replace function public.youtube_oauth_put_state(
  p_nonce_hash text,
  p_user_id uuid,
  p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube sign-in is not available.' using errcode = '42501';
  end if;

  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'That connection link is not valid.' using errcode = '22023';
  end if;

  if p_user_id is null or p_expires_at is null or p_expires_at <= now() then
    raise exception 'That connection link is not valid.' using errcode = '22023';
  end if;

  delete from private.youtube_oauth_states
  where expires_at < now() - interval '1 day';

  insert into private.youtube_oauth_states (nonce_hash, user_id, expires_at)
  values (p_nonce_hash, p_user_id, p_expires_at);
end;
$$;

create or replace function public.youtube_oauth_consume_state(p_nonce_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube sign-in is not available.' using errcode = '42501';
  end if;

  if p_nonce_hash is null or p_nonce_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  update private.youtube_oauth_states
    set used_at = now()
    where nonce_hash = p_nonce_hash
      and used_at is null
      and expires_at > now()
    returning user_id into v_user;

  return v_user;
end;
$$;

create or replace function public.youtube_connection_save(
  p_refresh_token text,
  p_channel_id text,
  p_channel_title text,
  p_connected_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_channel_title, ''));
  v_channel text := btrim(coalesce(p_channel_id, ''));
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube tokens are not available.' using errcode = '42501';
  end if;

  if p_refresh_token is null or char_length(p_refresh_token) < 20 or char_length(p_refresh_token) > 4096 then
    raise exception 'YouTube did not return a usable connection.' using errcode = '22023';
  end if;

  if char_length(v_channel) < 1 or char_length(v_channel) > 128
    or char_length(v_title) < 1 or char_length(v_title) > 200
  then
    raise exception 'YouTube did not return a channel.' using errcode = '22023';
  end if;

  insert into private.youtube_connections (
    id,
    refresh_token,
    channel_id,
    channel_title,
    connected_by,
    connected_at,
    updated_at,
    token_error
  )
  values (1, p_refresh_token, v_channel, v_title, p_connected_by, now(), now(), null)
  on conflict (id) do update
    set refresh_token = excluded.refresh_token,
        channel_id = excluded.channel_id,
        channel_title = excluded.channel_title,
        connected_by = excluded.connected_by,
        connected_at = now(),
        updated_at = now(),
        token_error = null;

  return jsonb_build_object(
    'connected', true,
    'channel_id', v_channel,
    'channel_title', v_title
  );
end;
$$;

create or replace function public.youtube_connection_read()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.youtube_connections%rowtype;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube tokens are not available.' using errcode = '42501';
  end if;

  select * into v_row
  from private.youtube_connections
  where id = 1;

  if not found then
    return jsonb_build_object('connected', false);
  end if;

  return jsonb_build_object(
    'connected', true,
    'refresh_token', v_row.refresh_token,
    'channel_id', v_row.channel_id,
    'channel_title', v_row.channel_title,
    'connected_at', v_row.connected_at,
    'token_error', v_row.token_error
  );
end;
$$;

comment on function public.youtube_connection_read() is
  'Service role only. Returns the refresh token to the Edge Function. The function must not send that field to the browser.';

create or replace function public.youtube_connection_note_refresh(p_refresh_token text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube tokens are not available.' using errcode = '42501';
  end if;

  if p_refresh_token is not null and char_length(p_refresh_token) >= 20 and char_length(p_refresh_token) <= 4096 then
    update private.youtube_connections
      set refresh_token = p_refresh_token,
          token_error = null,
          updated_at = now()
      where id = 1;
    return;
  end if;

  update private.youtube_connections
    set token_error = null,
        updated_at = now()
    where id = 1;
end;
$$;

create or replace function public.youtube_connection_mark_error(p_message text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message text := left(btrim(coalesce(p_message, '')), 300);
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube tokens are not available.' using errcode = '42501';
  end if;

  if char_length(v_message) < 1 then
    v_message := 'YouTube refresh token was rejected.';
  end if;

  update private.youtube_connections
    set token_error = v_message,
        updated_at = now()
    where id = 1;
end;
$$;

create or replace function public.youtube_broadcast_apply(
  p_game_stream_id uuid,
  p_next_status text,
  p_confirm_end boolean,
  p_actor uuid,
  p_watch_url text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stream public.game_streams%rowtype;
  v_url text;
  v_open boolean;
  v_status text;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'YouTube updates are not available.' using errcode = '42501';
  end if;

  if p_next_status is not null and p_next_status not in ('ready', 'ended') then
    raise exception 'Choose a stream status.' using errcode = '22023';
  end if;

  if p_next_status = 'ended' and p_confirm_end is distinct from true then
    raise exception 'YouTube end is not confirmed.' using errcode = '22023';
  end if;

  if p_watch_url is not null
    and p_watch_url ~ '^https://www\.youtube\.com/watch\?v=[A-Za-z0-9_-]{6,64}$'
  then
    v_url := p_watch_url;
  else
    v_url := null;
  end if;

  select * into v_stream
  from public.game_streams
  where id = p_game_stream_id
  for update;

  if not found then
    return jsonb_build_object('matched', false);
  end if;

  if p_confirm_end is true then
    update public.stream_jobs
      set status = 'done',
          error = null
      where game_stream_id = v_stream.id
        and action = 'end'
        and status = 'pending';

    if not exists (
      select 1
      from public.stream_jobs as job
      where job.game_stream_id = v_stream.id
        and job.action = 'end'
        and job.status = 'done'
    ) then
      insert into public.stream_jobs (game_stream_id, action, status, payload, created_by)
      values (v_stream.id, 'end', 'done', '{}'::jsonb, p_actor);
    end if;
  end if;

  if p_next_status = 'ended' then
    update public.game_streams
      set status = 'ended',
          last_error = null,
          youtube_url = coalesce(youtube_url, v_url)
      where id = v_stream.id;
  elsif p_next_status = 'ready' then
    select exists (
      select 1
      from public.stream_jobs as job
      where job.game_stream_id = v_stream.id
        and job.status in ('pending', 'running')
    ) into v_open;

    if not v_open then
      update public.game_streams
        set status = 'ready',
            last_error = null,
            youtube_url = coalesce(youtube_url, v_url)
        where id = v_stream.id
          and status is distinct from 'ready';
    end if;
  end if;

  select status into v_status
  from public.game_streams
  where id = v_stream.id;

  return jsonb_build_object(
    'matched', true,
    'game_stream_id', v_stream.id,
    'status', v_status,
    'end_confirmed', exists (
      select 1
      from public.stream_jobs as job
      where job.game_stream_id = v_stream.id
        and job.action = 'end'
        and job.status = 'done'
    )
  );
end;
$$;

comment on function public.youtube_broadcast_apply(uuid, text, boolean, uuid, text) is
  'Service role only. Sets a matched game stream to ready or ended. Ended is stored only when p_confirm_end is true, which the Edge Function passes after YouTube has confirmed complete. That also writes a done end job so the pop-up treats the YouTube end as confirmed.';

revoke all on function public.youtube_oauth_put_state(text, uuid, timestamptz) from public;
revoke all on function public.youtube_oauth_put_state(text, uuid, timestamptz) from anon;
revoke all on function public.youtube_oauth_put_state(text, uuid, timestamptz) from authenticated;
grant execute on function public.youtube_oauth_put_state(text, uuid, timestamptz) to service_role;

revoke all on function public.youtube_oauth_consume_state(text) from public;
revoke all on function public.youtube_oauth_consume_state(text) from anon;
revoke all on function public.youtube_oauth_consume_state(text) from authenticated;
grant execute on function public.youtube_oauth_consume_state(text) to service_role;

revoke all on function public.youtube_connection_save(text, text, text, uuid) from public;
revoke all on function public.youtube_connection_save(text, text, text, uuid) from anon;
revoke all on function public.youtube_connection_save(text, text, text, uuid) from authenticated;
grant execute on function public.youtube_connection_save(text, text, text, uuid) to service_role;

revoke all on function public.youtube_connection_read() from public;
revoke all on function public.youtube_connection_read() from anon;
revoke all on function public.youtube_connection_read() from authenticated;
grant execute on function public.youtube_connection_read() to service_role;

revoke all on function public.youtube_connection_note_refresh(text) from public;
revoke all on function public.youtube_connection_note_refresh(text) from anon;
revoke all on function public.youtube_connection_note_refresh(text) from authenticated;
grant execute on function public.youtube_connection_note_refresh(text) to service_role;

revoke all on function public.youtube_connection_mark_error(text) from public;
revoke all on function public.youtube_connection_mark_error(text) from anon;
revoke all on function public.youtube_connection_mark_error(text) from authenticated;
grant execute on function public.youtube_connection_mark_error(text) to service_role;

revoke all on function public.youtube_broadcast_apply(uuid, text, boolean, uuid, text) from public;
revoke all on function public.youtube_broadcast_apply(uuid, text, boolean, uuid, text) from anon;
revoke all on function public.youtube_broadcast_apply(uuid, text, boolean, uuid, text) from authenticated;
grant execute on function public.youtube_broadcast_apply(uuid, text, boolean, uuid, text) to service_role;
