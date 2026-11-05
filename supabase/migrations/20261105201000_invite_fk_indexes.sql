-- Cover the invites foreign keys so deletes of a profile or team
-- do not scan the whole invite list.

create index invites_invited_by_idx on public.invites (invited_by);
create index invites_team_idx on public.invites (team_id);
create index invites_accepted_user_idx on public.invites (accepted_user_id);
