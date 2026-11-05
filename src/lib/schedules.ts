import { actionError } from './errors.ts'
import { supabase } from './supabase.ts'
import type { ScheduleEvent, ScheduleEventType } from './types.ts'

function isEventType(value: unknown): value is ScheduleEventType {
  return value === 'league_game' || value === 'umpiring'
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
      starts_at: row.starts_at,
      match_format: typeof row.match_format === 'string' ? row.match_format : null,
      ground: row.ground,
      address: typeof row.address === 'string' ? row.address : null,
      opponent: row.opponent,
      event_type: row.event_type,
      division: typeof row.division === 'string' ? row.division : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
    })
  }
  return rows
}

const columns =
  'id, team_id, umpiring_team_id, game_date, start_time, starts_at, match_format, ground, address, opponent, event_type, division, notes'

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
  team_id: string
  event_type: ScheduleEventType
  game_date: string
  start_time: string
  match_format: string | null
  ground: string
  address: string | null
  opponent: string
  division: string | null
  notes: string | null
}

export async function saveFixture(input: FixtureInput): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const payload = {
    team_id: input.team_id,
    umpiring_team_id: input.event_type === 'umpiring' ? input.team_id : null,
    event_type: input.event_type,
    game_date: input.game_date,
    start_time: input.start_time,
    match_format: input.match_format,
    ground: input.ground.trim(),
    address: input.address,
    opponent: input.opponent.trim(),
    division: input.division,
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
