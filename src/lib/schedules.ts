import { actionError } from './errors.ts'
import { isBallColor, isDressCode, isGameResult, isVenueSide } from './games.ts'
import {
  eventKindLabel,
  eventTitle,
  eventsInPacificWeek,
  isCheetahsLeagueGame,
  isCompletedLeagueListing,
  isUpcomingLeagueGame,
} from './scheduleRules.ts'
import { supabase } from './supabase.ts'
import { SCHEDULE_EVENT_TYPES, type ScheduleEvent, type ScheduleEventType } from './types.ts'

export {
  eventKindLabel,
  eventTitle,
  eventsInPacificWeek,
  isCheetahsLeagueGame,
  isCompletedLeagueListing,
  isUpcomingLeagueGame,
}

function isEventType(value: unknown): value is ScheduleEventType {
  return value === 'league_game' || value === 'umpiring' || value === 'practice' || value === 'other'
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
      series_id: typeof row.series_id === 'string' ? row.series_id : null,
      venue_side: typeof row.venue_side === 'string' && isVenueSide(row.venue_side) ? row.venue_side : null,
      ball_color: typeof row.ball_color === 'string' && isBallColor(row.ball_color) ? row.ball_color : null,
      dress_code: typeof row.dress_code === 'string' && isDressCode(row.dress_code) ? row.dress_code : null,
      result: typeof row.result === 'string' && isGameResult(row.result) ? row.result : null,
      scorecard_url: typeof row.scorecard_url === 'string' ? row.scorecard_url : null,
      video_url: typeof row.video_url === 'string' && row.video_url.trim().length > 0 ? row.video_url : null,
      match_status: row.match_status === 'completed' ? 'completed' : 'scheduled',
    })
  }
  return rows
}

const columns =
  'id, team_id, umpiring_team_id, game_date, start_time, end_time, starts_at, ends_at, match_format, ground, address, opponent, event_type, division, notes, created_by, series_id, venue_side, ball_color, dress_code, result, scorecard_url, video_url, match_status'

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

export async function loadScheduleBetween(
  from: string,
  to: string,
): Promise<{ rows: ScheduleEvent[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('schedule_events')
    .select(columns)
    .gte('game_date', from)
    .lte('game_date', to)
    .order('starts_at', { ascending: true })
    .limit(500)
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
  venue_side: ScheduleEvent['venue_side']
  ball_color: ScheduleEvent['ball_color']
  dress_code: ScheduleEvent['dress_code']
  result: ScheduleEvent['result']
  scorecard_url: string | null
  video_url: string | null
  match_status: ScheduleEvent['match_status']
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
    venue_side: input.event_type === 'league_game' ? input.venue_side : null,
    ball_color: input.event_type === 'league_game' ? input.ball_color : null,
    dress_code: input.event_type === 'league_game' ? input.dress_code : null,
    result: input.event_type === 'league_game' ? input.result : null,
    scorecard_url: input.event_type === 'league_game' ? input.scorecard_url : null,
    video_url: input.event_type === 'league_game' ? input.video_url : null,
    match_status: input.event_type === 'league_game' ? input.match_status : 'scheduled',
  }
  const { error } = input.id
    ? await supabase.from('schedule_events').update(payload).eq('id', input.id)
    : await supabase.from('schedule_events').insert(payload)
  return error ? actionError(error.message) : null
}

export async function saveFixtureSeries(inputs: FixtureInput[], seriesId: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  if (inputs.length < 1) return 'Choose at least one date.'
  const rows = []
  for (const input of inputs) {
    if (!SCHEDULE_EVENT_TYPES.includes(input.event_type)) return 'Choose an event type.'
    rows.push({
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
      series_id: seriesId,
      venue_side: input.event_type === 'league_game' ? input.venue_side : null,
      ball_color: input.event_type === 'league_game' ? input.ball_color : null,
      dress_code: input.event_type === 'league_game' ? input.dress_code : null,
      result: input.event_type === 'league_game' ? input.result : null,
      scorecard_url: input.event_type === 'league_game' ? input.scorecard_url : null,
      video_url: input.event_type === 'league_game' ? input.video_url : null,
      match_status: input.event_type === 'league_game' ? input.match_status : 'scheduled',
    })
  }
  const { error } = await supabase.from('schedule_events').insert(rows)
  return error ? actionError(error.message) : null
}

export async function saveGameVideo(id: string, videoUrl: string | null): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('schedule_events').update({ video_url: videoUrl }).eq('id', id)
  return error ? actionError(error.message) : null
}

export async function removeFixture(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('schedule_events').delete().eq('id', id)
  return error ? actionError(error.message) : null
}
