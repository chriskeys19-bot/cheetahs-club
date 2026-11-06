import { actionError } from './errors.ts'
import { isoToPacificWall, pacificWallToIso } from './format.ts'
import { addCivilDays, civilDayOffset } from './recurrence.ts'
import { supabase } from './supabase.ts'
import type { Activity } from './types.ts'

function parseActivities(value: unknown): Activity[] {
  if (!Array.isArray(value)) return []
  const rows: Activity[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.title !== 'string' || typeof row.starts_at !== 'string') {
      continue
    }
    if (typeof row.created_at !== 'string') continue
    rows.push({
      id: row.id,
      title: row.title,
      description: typeof row.description === 'string' ? row.description : null,
      starts_at: row.starts_at,
      ends_at: typeof row.ends_at === 'string' ? row.ends_at : null,
      location: typeof row.location === 'string' ? row.location : null,
      team_id: typeof row.team_id === 'string' ? row.team_id : null,
      created_by: typeof row.created_by === 'string' ? row.created_by : null,
      created_at: row.created_at,
      series_id: typeof row.series_id === 'string' ? row.series_id : null,
    })
  }
  return rows
}

const columns =
  'id, title, description, starts_at, ends_at, location, team_id, created_by, created_at, series_id'

export async function loadActivities(range: {
  from: string
  to?: string
}): Promise<{ rows: Activity[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  let query = supabase.from('activities').select(columns).gte('starts_at', range.from)
  if (range.to) query = query.lt('starts_at', range.to)
  const { data, error } = await query.order('starts_at', { ascending: true }).limit(200)
  if (error) return { rows: [], error: error.message }
  return { rows: parseActivities(data), error: null }
}

export async function saveActivity(input: {
  id?: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  location: string | null
  team_id: string | null
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const payload = {
    title: input.title.trim(),
    description: input.description,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    location: input.location,
    team_id: input.team_id,
  }
  const { error } = input.id
    ? await supabase.from('activities').update(payload).eq('id', input.id)
    : await supabase.from('activities').insert(payload)
  return error ? actionError(error.message) : null
}

export async function saveActivitySeries(
  inputs: Array<{
    title: string
    description: string | null
    starts_at: string
    ends_at: string | null
    location: string | null
    team_id: string | null
  }>,
  seriesId: string,
): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  if (inputs.length < 1) return 'Choose at least one date.'
  const rows = inputs.map((input) => ({
    title: input.title.trim(),
    description: input.description,
    starts_at: input.starts_at,
    ends_at: input.ends_at,
    location: input.location,
    team_id: input.team_id,
    series_id: seriesId,
  }))
  const { error } = await supabase.from('activities').insert(rows)
  return error ? actionError(error.message) : null
}

export async function removeActivity(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('activities').delete().eq('id', id)
  return error ? actionError(error.message) : null
}

async function loadActivitySeries(seriesId: string): Promise<{ rows: Activity[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase
    .from('activities')
    .select(columns)
    .eq('series_id', seriesId)
    .order('starts_at', { ascending: true })
  if (error) return { rows: [], error: error.message }
  return { rows: parseActivities(data), error: null }
}

/**
 * Apply one edited occurrence to every row that shares its series_id.
 * Title, details, location, and side are copied. Each date keeps its place
 * in the series and shifts by the same number of Pacific days, then uses the
 * edited start time. A cleared end time clears the end on every date.
 */
export async function updateActivitySeries(input: {
  seriesId: string
  anchorStartsAt: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  location: string | null
  team_id: string | null
}): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const loaded = await loadActivitySeries(input.seriesId)
  if (loaded.error) return loaded.error
  if (loaded.rows.length === 0) return 'That series could not be found.'

  const anchorWall = isoToPacificWall(input.anchorStartsAt)
  const nextWall = isoToPacificWall(input.starts_at)
  const dayDelta = anchorWall.date && nextWall.date ? civilDayOffset(anchorWall.date, nextWall.date) : null
  if (dayDelta === null || !nextWall.time) return 'The start time could not be read.'

  let endOffset: number | null = null
  let endTime = ''
  if (input.ends_at) {
    const endWall = isoToPacificWall(input.ends_at)
    endOffset = nextWall.date && endWall.date ? civilDayOffset(nextWall.date, endWall.date) : null
    endTime = endWall.time
    if (endOffset === null || !endTime) return 'The end time could not be read.'
  }

  for (const row of loaded.rows) {
    const rowWall = isoToPacificWall(row.starts_at)
    const shifted = rowWall.date ? addCivilDays(rowWall.date, dayDelta) : null
    if (!shifted) return 'One of the series dates could not be moved.'
    const startsAt = pacificWallToIso(shifted, nextWall.time)
    if (!startsAt) return 'One of the series dates could not be saved.'
    let endsAt: string | null = null
    if (endOffset !== null) {
      const endDay = addCivilDays(shifted, endOffset)
      endsAt = endDay ? pacificWallToIso(endDay, endTime) : null
      if (!endsAt) return 'One of the series end times could not be saved.'
    }
    if (endsAt && endsAt < startsAt) return 'The end has to be after the start on every date.'
    const { error } = await supabase
      .from('activities')
      .update({
        title: input.title,
        description: input.description,
        starts_at: startsAt,
        ends_at: endsAt,
        location: input.location,
        team_id: input.team_id,
      })
      .eq('id', row.id)
    if (error) return actionError(error.message)
  }
  return null
}

export async function removeActivitySeries(seriesId: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('activities').delete().eq('series_id', seriesId)
  return error ? actionError(error.message) : null
}
