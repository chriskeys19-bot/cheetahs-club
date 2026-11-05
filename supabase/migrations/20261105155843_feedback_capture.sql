-- Suggestions from any signed-in club role. The browser writes here only.
-- A later job can copy rows to the club sheet; do not call Sheets from the client.

create schema if not exists private;

revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated;
grant usage on schema private to service_role;

create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  submitter_name text,
  submitter_email text,
  role text,
  body text not null,
  created_at timestamptz not null default now(),
  constraint feedback_role_check check (
    role is null or role in ('admin', 'captain', 'player')
  ),
  constraint feedback_body_not_blank check (
    char_length(btrim(body)) between 1 and 2000
  )
);

comment on table public.feedback is
  'Club suggestions. Members insert their own rows; admins can read every row.';

create index feedback_user_created_idx
  on public.feedback (user_id, created_at desc);

create index feedback_created_idx
  on public.feedback (created_at desc);

-- Stamp identity from the session so a client cannot file a suggestion as someone else.
create or replace function private.stamp_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_name text;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select u.email
    into v_email
  from auth.users as u
  where u.id = auth.uid();

  select p.full_name, p.role
    into v_name, v_role
  from public.profiles as p
  where p.id = auth.uid();

  new.user_id := auth.uid();
  new.submitter_email := v_email;
  new.submitter_name := coalesce(
    nullif(btrim(coalesce(v_name, '')), ''),
    split_part(coalesce(v_email, ''), '@', 1)
  );
  new.role := coalesce(v_role, 'player');
  new.created_at := now();
  return new;
end;
$$;

revoke all on function private.stamp_feedback() from public;
grant execute on function private.stamp_feedback() to authenticated;
grant execute on function private.stamp_feedback() to service_role;

create trigger feedback_stamp_identity
  before insert on public.feedback
  for each row
  execute function private.stamp_feedback();

alter table public.feedback enable row level security;

revoke all on table public.feedback from public;
revoke all on table public.feedback from anon;
revoke all on table public.feedback from authenticated;
grant select, insert on table public.feedback to authenticated;
grant select, insert, update, delete on table public.feedback to service_role;

create policy feedback_insert_own
  on public.feedback
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy feedback_select_own
  on public.feedback
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy feedback_select_admin
  on public.feedback
  for select
  to authenticated
  using ((select public.current_role()) = 'admin');
