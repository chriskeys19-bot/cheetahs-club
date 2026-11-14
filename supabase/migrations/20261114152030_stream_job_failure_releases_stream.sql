-- Release a game stream when its job fails, and expire steps that never finish.
--
-- Applied on project lutcbvzunjcosncvdyke on 2026-11-14 as
-- stream_job_failure_releases_stream, plus private.expire_stale_stream_jobs()
-- and the pg_cron job expire-stale-stream-jobs. The definitions below match
-- what was live after that hot apply.
--
-- game_streams.updated_at does not need a separate touch trigger.
-- private.guard_game_stream_update() is BEFORE UPDATE on game_streams and sets
-- new.updated_at := now() before any other check. stream_jobs.updated_at is
-- maintained by stream_jobs_touch. The 30-minute stale check uses those clocks.
-- Inserts take the column default now().

create or replace function private.stream_job_failed_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'failed' and (old.status is distinct from 'failed') then
    update public.game_streams
       set status = 'failed',
           last_error = left(coalesce(new.error, 'Stream job failed. Tap Retry.'), 500)
     where id = new.game_stream_id
       and status in ('checking', 'creating', 'setting_up_overlay', 'updating_stream', 'ending');
  end if;
  return new;
end
$$;

comment on function private.stream_job_failed_release() is
  'When a stream job becomes failed, mark the game stream failed if it is still in an in-progress status.';

drop trigger if exists stream_jobs_failed_release on public.stream_jobs;

create trigger stream_jobs_failed_release
  after update of status on public.stream_jobs
  for each row execute function private.stream_job_failed_release();

create or replace function private.expire_stale_stream_jobs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.stream_jobs
     set status = 'failed',
         error = 'This stream step timed out after 30 minutes. Tap Retry.'
   where status in ('pending', 'running')
     and updated_at < now() - interval '30 minutes';

  update public.game_streams gs
     set status = 'failed',
         last_error = 'This stream step stopped without finishing. Tap Retry.'
   where gs.status in ('checking', 'creating', 'setting_up_overlay', 'updating_stream', 'ending')
     and gs.updated_at < now() - interval '30 minutes'
     and not exists (
       select 1
       from public.stream_jobs j
       where j.game_stream_id = gs.id
         and j.status in ('pending', 'running')
     );
end
$$;

comment on function private.expire_stale_stream_jobs() is
  'Fail pending or running stream jobs older than 30 minutes, and fail in-progress streams that have no active job and have not been updated for 30 minutes.';

do $$
begin
  if exists (select 1 from cron.job where jobname = 'expire-stale-stream-jobs') then
    perform cron.unschedule('expire-stale-stream-jobs');
  end if;
end
$$;

select cron.schedule(
  'expire-stale-stream-jobs',
  '*/10 * * * *',
  $$select private.expire_stale_stream_jobs()$$
);
