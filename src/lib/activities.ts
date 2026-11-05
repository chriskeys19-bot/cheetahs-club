import { actionError } from './errors.ts'
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
    })
  }
  return rows
}

const columns =
  'id, title, description, starts_at, ends_at, location, team_id, created_by, created_at'

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

export async function removeActivity(id: string): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('activities').delete().eq('id', id)
  return error ? actionError(error.message) : null
}
