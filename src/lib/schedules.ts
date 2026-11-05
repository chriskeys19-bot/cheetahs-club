import { actionError } from './errors.ts'
import { supabase } from './supabase.ts'
import { SCHEDULE_EVENT_TYPES, type ScheduleEvent, type ScheduleEventType } from './types.ts'

function isEventType(value: unknown): value is ScheduleEventType {
  return value === 'league_game' || value === 'umpiring' || value === 'practice' || value === 'other'
}

export function eventKindLabel(type: ScheduleEventType): string {
  if (type === 'league_game') return 'League'
  if (type === 'umpiring') return 'Umpiring'
  if (type === 'practice') return 'Practice'
  return 'Other'
}

export function eventTitle(
  event: Pick<ScheduleEvent, 'event_type' | 'opponent'>,
  sideName: string | null,
): string {
  const side = sideName?.replace(/^Cheetahs /, '') ?? null
  if (event.event_type === 'umpiring') return event.opponent
  if (event.event_type === 'practice') {
    const label = event.opponent.trim()
    if (label.length > 0 && label.toLowerCase() !== 'cheetahs practice') return label
    return side ? `${side} practice` : 'Cheetahs practice'
  }
  if (event.event_type === 'other') return event.opponent
  return `${side ?? 'Club'} vs ${event.opponent}`
}

export function eventsInPacificWeek(
  events: ScheduleEvent[],
  start: string,
  end: string,
): ScheduleEvent[] {
  return events.filter((event) => {
    const day = event.game_date.slice(0, 10)
    return day >= start && day <= end
  })
}

function parseEvents(value: unknown): ScheduleEvent[] {
  if (!Array.isArray(value)) return []
  const rows: ScheduleEvent[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (
      typeof row.id !== 'string' ||
      typeof row.game_date !== 'string' ||
      typeof row.start_time !== 'string' ||
      typeof row.starts_at !== 'string' ||
      typeof row.ground !== 'string' ||
      typeof row.opponent !== 'string' ||
      !isEventType(row.event_type)
    ) {
      continue
    }
    rows.push({
      id: row.id,
      team_id: typeof row.team_id === 'string' ? row.team_id : null,
      umpiring_team_id: typeof row.umpiring_team_id === 'string' ? row.umpiring_team_id : null,
      game_date: row.game_date,
      start_time: row.start_time,
      end_time: typeof row.end_time === 'string' ? row.end_time : null,
      starts_at: row.starts_at,
      ends_at: typeof row.ends_at === 'string' ? row.ends_at : null,
      match_format: typeof row.match_format === 'string' ? row.match_format : null,
      ground: row.ground,
      address: typeof row.address === 'string' ? row.address : null,
      opponent: row.opponent,
      event_type: row.event_type,
      division: typeof row.division === 'string' ? row.division : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
    })
  }
  return rows
}

const columns =
  'id, team_id, umpiring_team_id, game_date, start_time, end_time, starts_at, ends_at, match_format, ground, address, opponent, event_type, division, notes, created_by'

export async function loadSchedule(): Promise<{ rows: ScheduleEvent[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('schedule_events')
    .select(columns)
    .order('starts_at', { ascending: true })
    .limit(300)
  if (error) return { rows: [], error: error.message }
  return { rows: parseEvents(data), error: null }
}

export type FixtureInput = {
  id?: string
  team_id: string | null
  event_type: ScheduleEventType
  game_date: string
  start_time: string
  end_time: string | null
  match_format: string | null
  ground: string
  address: string | null
  opponent: string
  division: string | null
  notes: string | null
}

export async function saveFixture(input: FixtureInput): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  if (!SCHEDULE_EVENT_TYPES.includes(input.event_type)) return 'Choose an event type.'
  const payload = {
    team_id: input.team_id,
    umpiring_team_id: input.event_type === 'umpiring' ? input.team_id : null,
    event_type: input.event_type,
    game_date: input.game_date,
    start_time: input.start_time,
    end_time: input.end_time,
    match_format: input.match_format,
    ground: input.ground.trim(),
    address: input.address,
    opponent: input.opponent.trim(),
    division: input.event_type === 'umpiring' ? input.division : null,
    notes: input.notes,
  }
  const { error } = input.id
    ? await supabase.from('schedule_events').update(payload).eq('id', input.id)
    : await supabase.from('schedule_events').insert(payload)
  return error ? actionError(error.message) : null
}

export async function removeFixture(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('schedule_events').delete().eq('id', id)
  return error ? actionError(error.message) : null
}
