-- Admin password-reset audit.
--
-- The browser cannot insert these rows. admin-reset-password checks the
-- caller's saved profiles.role, then inserts with the service role.
-- The View-as switcher does not change that role. Admins can read the log.
-- anon and authenticated cannot write it.

create table public.password_reset_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null,
  target_id uuid not null,
  email_requested boolean not null,
  emailed boolean not null,
  created_at timestamptz not null default now(),
  constraint password_reset_audit_email_check check (not emailed or email_requested)
);

comment on table public.password_reset_audit is
  'One row each time an admin generates a member password recovery link. The link itself is not stored.';

comment on column public.password_reset_audit.actor_id is
  'profiles.id of the admin who generated the link.';

comment on column public.password_reset_audit.target_id is
  'profiles.id of the member the link is for.';

create index password_reset_audit_created_idx
  on public.password_reset_audit (created_at desc);

alter table public.password_reset_audit enable row level security;
alter table public.password_reset_audit force row level security;

revoke all on table public.password_reset_audit from public;
revoke all on table public.password_reset_audit from anon;
revoke all on table public.password_reset_audit from authenticated;
grant select on table public.password_reset_audit to authenticated;
grant select, insert on table public.password_reset_audit to service_role;

create policy password_reset_audit_admin_select
  on public.password_reset_audit
  for select
  to authenticated
  using ((select private.current_role()) = 'admin');

comment on policy password_reset_audit_admin_select on public.password_reset_audit is
  'Admins can read the reset log. Inserts come from the service role in admin-reset-password.';
