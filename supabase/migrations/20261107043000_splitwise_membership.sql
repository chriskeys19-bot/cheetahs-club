-- Records whether a club profile has been added to the Cheetahs Splitwise
-- group. splitwise-ensure-member writes this with the service role after it
-- checks get_group and, when needed, calls add_user_to_group.
--
-- The browser reads only its own row so a later page load can skip Splitwise.
-- Authenticated users cannot insert, update, or delete. A member cannot mark
-- themselves added.
--
-- Columns the app cares about:
--   splitwise_user_id   Splitwise member id once the email is in the group
--   splitwise_added_at  when that id was recorded; null means not added yet
--   last_error          safe message from the last failed attempt, never the API key
--   last_attempt_at     used to wait ten minutes before calling Splitwise again
--
-- This file has no UPDATE or DELETE. pg-safeupdate rejects those without WHERE
-- on API sessions. The Edge Function updates one row with WHERE profile_id = ?.

create table public.splitwise_membership (
  profile_id uuid primary key references public.profiles (id) on delete cascade,
  splitwise_user_id bigint,
  splitwise_added_at timestamptz,
  last_error text,
  last_attempt_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint splitwise_membership_user_positive check (
    splitwise_user_id is null or splitwise_user_id > 0
  ),
  constraint splitwise_membership_error_length check (
    last_error is null or char_length(last_error) between 1 and 500
  ),
  constraint splitwise_membership_added_has_user check (
    splitwise_added_at is null or splitwise_user_id is not null
  )
);

comment on table public.splitwise_membership is
  'One row per club profile that splitwise-ensure-member has tried. splitwise_added_at means the sign-in email is already in the Splitwise group, so later loads do not call Splitwise.';

comment on column public.splitwise_membership.splitwise_user_id is
  'Splitwise user id for this profile. Null until the email is found in the group or add_user_to_group returns an id.';

comment on column public.splitwise_membership.splitwise_added_at is
  'When this profile was recorded as a member of the Cheetahs group. Null means the next sign-in may try again.';

comment on column public.splitwise_membership.last_error is
  'Short safe error from the last failed attempt. Never the Splitwise API key.';

comment on column public.splitwise_membership.last_attempt_at is
  'Start of the ten-minute wait after a failure. A page reload inside that window does not call Splitwise.';

create unique index splitwise_membership_splitwise_user_id_key
  on public.splitwise_membership (splitwise_user_id)
  where splitwise_user_id is not null;

alter table public.splitwise_membership enable row level security;
alter table public.splitwise_membership force row level security;

revoke all on table public.splitwise_membership from public;
revoke all on table public.splitwise_membership from anon;
revoke all on table public.splitwise_membership from authenticated;
grant select on table public.splitwise_membership to authenticated;
grant select, insert, update, delete on table public.splitwise_membership to service_role;

create policy splitwise_membership_select_own on public.splitwise_membership
  for select to authenticated
  using (profile_id = (select auth.uid()));

comment on policy splitwise_membership_select_own on public.splitwise_membership is
  'A member can read whether their own email was added. Writes stay on the service role.';

notify pgrst, 'reload schema';
