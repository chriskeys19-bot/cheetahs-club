-- Cheetahs Club Phase 1: profiles, teams, RLS
create extension if not exists "pgcrypto";

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  role text not null default 'player' check (role in ('admin', 'captain', 'player')),
  created_at timestamptz not null default now()
);

create table public.team_members (
  team_id uuid not null references public.teams (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, profile_id)
);

insert into public.teams (name, slug) values
  ('Cheetahs Alpha', 'alpha'),
  ('Cheetahs Beta', 'beta'),
  ('Cheetahs Gamma', 'gamma');

create or replace function public.current_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data->>'role', 'player')
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

alter table public.teams enable row level security;
alter table public.profiles enable row level security;
alter table public.team_members enable row level security;

create policy teams_select_authenticated on public.teams
  for select to authenticated using (true);

create policy teams_write_admin on public.teams
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy profiles_select_own_or_admin on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.current_role() = 'admin');

create policy profiles_update_own_name on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = (select p.role from public.profiles p where p.id = auth.uid())
  );

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');

create policy team_members_select_authenticated on public.team_members
  for select to authenticated using (true);

create policy team_members_write_admin on public.team_members
  for all to authenticated
  using (public.current_role() = 'admin')
  with check (public.current_role() = 'admin');
