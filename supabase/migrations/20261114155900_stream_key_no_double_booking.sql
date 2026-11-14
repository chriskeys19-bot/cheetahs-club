-- One device key for one live or scheduled stream.
--
-- Applied on project lutcbvzunjcosncvdyke on 2026-11-14 as
-- stream_key_no_double_booking. A stream key (Yolobox Pro 1, 2, or 3) may be
-- held by only one row in creating, awaiting_scorecard, setting_up_overlay,
-- updating_stream, ready, or ending. Keys on none, ended, and failed streams
-- are free. If the requested key is held by another game, the first active
-- free key by sort_order is assigned instead. This file matches that live
-- function, including leaving the requested key in place when every key is busy.
-- A later migration refuses that last case.

create or replace function private.pick_free_stream_key()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  free_key text;
begin
  if new.stream_key_name is null or new.status in ('none', 'ended', 'failed') then
    return new;
  end if;

  if exists (
    select 1
    from public.game_streams o
    where o.id <> new.id
      and o.stream_key_name = new.stream_key_name
      and o.status in (
        'creating',
        'awaiting_scorecard',
        'setting_up_overlay',
        'updating_stream',
        'ready',
        'ending'
      )
  ) then
    select k.name into free_key
    from public.stream_keys k
    where k.active
      and not exists (
        select 1
        from public.game_streams o
        where o.id <> new.id
          and o.stream_key_name = k.name
          and o.status in (
            'creating',
            'awaiting_scorecard',
            'setting_up_overlay',
            'updating_stream',
            'ready',
            'ending'
          )
      )
    order by k.sort_order
    limit 1;

    if free_key is not null then
      new.stream_key_name := free_key;
    end if;
  end if;

  return new;
end
$$;

comment on function private.pick_free_stream_key() is
  'Before a stream is saved, move it off a device key that another live or scheduled game already holds.';

drop trigger if exists game_streams_free_key on public.game_streams;

create trigger game_streams_free_key
  before insert or update of status, stream_key_name on public.game_streams
  for each row execute function private.pick_free_stream_key();
