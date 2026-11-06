-- Edit and delete for announcements, activities, and polls.
--
-- Admins and captains can update or delete any row. A player can update or
-- delete only a row they created (created_by = auth.uid()).
-- Insert policies are unchanged: only admin and captain can create these rows.
--
-- announcements already stored the creator in author_id. created_by is added
-- so the three boards share one ownership column. The stamp trigger keeps
-- created_by equal to author_id. Existing notes are backfilled from author_id.
-- activities.created_by and polls.created_by already exist and are stamped on
-- insert; this only adds the auth.uid() default. Null creators stay
-- staff-managed, because there is no earlier author to copy.
--
-- Deleting a poll removes its choices and votes. Removing one choice that
-- already has votes is rejected so those votes are not dropped. Renaming a
-- choice does not touch votes.

alter table public.announcements
  add column if not exists created_by uuid references auth.users (id) on delete set null;

comment on column public.announcements.created_by is
  'Member who posted the note. Stamped from auth.uid() on insert and kept equal to author_id. Null only when that member is removed.';

update public.announcements
set created_by = author_id
where created_by is null
  and author_id is not null;

alter table public.announcements
  alter column created_by set default auth.uid();

alter table public.activities
  alter column created_by set default auth.uid();

alter table public.polls
  alter column created_by set default auth.uid();

create index if not exists announcements_created_by_idx
  on public.announcements (created_by);

create or replace function private.stamp_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
    and not (select private.is_staff())
    and old.created_by is distinct from (select auth.uid())
  then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  new.body := btrim(new.body);

  if tg_op = 'INSERT' then
    new.author_id := (select auth.uid());
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.updated_at := now();
  else
    new.author_id := old.author_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function private.stamp_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
    and not (select private.is_staff())
    and old.created_by is distinct from (select auth.uid())
  then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.title := btrim(new.title);
  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;
  if new.location is not null then
    new.location := nullif(btrim(new.location), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create or replace function private.stamp_poll()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not (select private.is_staff()) then
    raise exception 'staff role required' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
    and not (select private.is_staff())
    and old.created_by is distinct from (select auth.uid())
  then
    raise exception 'staff role required' using errcode = '42501';
  end if;

  new.question := btrim(new.question);
  if new.description is not null then
    new.description := nullif(btrim(new.description), '');
  end if;

  if tg_op = 'INSERT' then
    new.created_by := (select auth.uid());
    new.created_at := now();
    new.status := coalesce(nullif(btrim(new.status), ''), 'open');
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

-- Votes are removed before choices so the choice trigger below does not
-- block a poll delete. A direct delete of one choice still sees its votes.
create or replace function private.delete_poll_children()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.poll_votes
  where poll_id = old.id;

  delete from public.poll_options
  where poll_id = old.id;

  return old;
end;
$$;

comment on function private.delete_poll_children() is
  'Before a poll row is removed, delete its votes and then its choices. Runs as the function owner so forced row level security does not block the cascade.';

revoke all on function private.delete_poll_children() from public;
revoke all on function private.delete_poll_children() from anon;
grant execute on function private.delete_poll_children() to authenticated;
grant execute on function private.delete_poll_children() to service_role;

create or replace function private.block_voted_option_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.poll_votes as v
    where v.option_id = old.id
  ) then
    raise exception 'choice has votes' using errcode = '42501';
  end if;
  return old;
end;
$$;

comment on function private.block_voted_option_delete() is
  'Rejects deleting one poll choice while it still has votes. Poll deletion clears votes first, so the whole poll can still be removed.';

revoke all on function private.block_voted_option_delete() from public;
revoke all on function private.block_voted_option_delete() from anon;
grant execute on function private.block_voted_option_delete() to authenticated;
grant execute on function private.block_voted_option_delete() to service_role;

drop trigger if exists polls_delete_children on public.polls;
create trigger polls_delete_children
  before delete on public.polls
  for each row
  execute function private.delete_poll_children();

drop trigger if exists poll_options_block_voted_delete on public.poll_options;
create trigger poll_options_block_voted_delete
  before delete on public.poll_options
  for each row
  execute function private.block_voted_option_delete();

drop policy if exists announcements_update_staff on public.announcements;
create policy announcements_update_staff on public.announcements
  for update to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  )
  with check (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy announcements_update_staff on public.announcements is
  'Admin and captain can edit any announcement. A player can edit only a note they posted.';

drop policy if exists announcements_delete_staff on public.announcements;
create policy announcements_delete_staff on public.announcements
  for delete to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy announcements_delete_staff on public.announcements is
  'Admin and captain can delete any announcement. A player can delete only a note they posted.';

drop policy if exists activities_update_staff on public.activities;
create policy activities_update_staff on public.activities
  for update to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  )
  with check (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy activities_update_staff on public.activities is
  'Admin and captain can edit any activity. A player can edit only an activity they added.';

drop policy if exists activities_delete_staff on public.activities;
create policy activities_delete_staff on public.activities
  for delete to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy activities_delete_staff on public.activities is
  'Admin and captain can delete any activity. A player can delete only an activity they added.';

drop policy if exists polls_update_staff on public.polls;
create policy polls_update_staff on public.polls
  for update to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  )
  with check (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy polls_update_staff on public.polls is
  'Admin and captain can edit or close any poll. A player can edit only a poll they opened.';

drop policy if exists polls_delete_staff on public.polls;
create policy polls_delete_staff on public.polls
  for delete to authenticated
  using (
    (select private.is_staff())
    or created_by = (select auth.uid())
  );

comment on policy polls_delete_staff on public.polls is
  'Admin and captain can delete any poll. A player can delete only a poll they opened. Choices and votes are removed with the poll.';

-- Choice writes follow the parent poll. Creating a poll is still staff-only
-- because polls_insert_staff is unchanged.
drop policy if exists poll_options_insert_staff on public.poll_options;
create policy poll_options_insert_staff on public.poll_options
  for insert to authenticated
  with check (
    exists (
      select 1
      from public.polls as p
      where p.id = poll_options.poll_id
        and (
          (select private.is_staff())
          or p.created_by = (select auth.uid())
        )
    )
  );

comment on policy poll_options_insert_staff on public.poll_options is
  'Admin, captain, or the member who opened the poll can add a choice. This does not allow a player to create a poll.';

drop policy if exists poll_options_update_staff on public.poll_options;
create policy poll_options_update_staff on public.poll_options
  for update to authenticated
  using (
    exists (
      select 1
      from public.polls as p
      where p.id = poll_options.poll_id
        and (
          (select private.is_staff())
          or p.created_by = (select auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1
      from public.polls as p
      where p.id = poll_options.poll_id
        and (
          (select private.is_staff())
          or p.created_by = (select auth.uid())
        )
    )
  );

comment on policy poll_options_update_staff on public.poll_options is
  'Admin, captain, or the member who opened the poll can rename or reorder a choice. Votes stay on that choice.';

drop policy if exists poll_options_delete_staff on public.poll_options;
create policy poll_options_delete_staff on public.poll_options
  for delete to authenticated
  using (
    exists (
      select 1
      from public.polls as p
      where p.id = poll_options.poll_id
        and (
          (select private.is_staff())
          or p.created_by = (select auth.uid())
        )
    )
  );

comment on policy poll_options_delete_staff on public.poll_options is
  'Admin, captain, or the member who opened the poll can remove a choice that has no votes. A choice with votes cannot be removed.';

-- Titles, notes, questions, and descriptions may be plain text or a small HTML
-- subset (bold, lists, heading, small/large). The visible-text limit matches
-- the old plain-text limit. The raw limit leaves room for the tags.
-- Option labels stay plain.

create or replace function private.visible_text_length(value text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select char_length(btrim(regexp_replace(
    regexp_replace(coalesce(value, ''), '<[^>]+>', '', 'g'),
    '&(?:amp|lt|gt|quot|nbsp|#39|#x27);',
    'x',
    'g'
  )));
$$;

comment on function private.visible_text_length(text) is
  'Approximate visible length of plain text or the club rich-text HTML. Tags are removed and common entities count as one character.';

revoke all on function private.visible_text_length(text) from public;
revoke all on function private.visible_text_length(text) from anon;
grant execute on function private.visible_text_length(text) to authenticated;
grant execute on function private.visible_text_length(text) to service_role;

alter table public.announcements
  drop constraint announcements_title_length,
  drop constraint announcements_body_length;

alter table public.announcements
  add constraint announcements_title_length check (
    char_length(title) between 1 and 4000
    and private.visible_text_length(title) between 1 and 140
  ),
  add constraint announcements_body_length check (
    char_length(body) between 1 and 30000
    and private.visible_text_length(body) between 1 and 4000
  );

alter table public.activities
  drop constraint activities_title_length,
  drop constraint activities_description_length;

alter table public.activities
  add constraint activities_title_length check (
    char_length(title) between 1 and 4000
    and private.visible_text_length(title) between 1 and 140
  ),
  add constraint activities_description_length check (
    description is null
    or (
      char_length(description) between 1 and 16000
      and private.visible_text_length(description) between 1 and 2000
    )
  );

alter table public.polls
  drop constraint polls_question_length,
  drop constraint polls_description_length;

alter table public.polls
  add constraint polls_question_length check (
    char_length(question) between 1 and 8000
    and private.visible_text_length(question) between 1 and 280
  ),
  add constraint polls_description_length check (
    description is null
    or (
      char_length(description) between 1 and 16000
      and private.visible_text_length(description) between 1 and 2000
    )
  );
