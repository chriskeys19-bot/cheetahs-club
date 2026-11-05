import { supabase } from './supabase.ts'
import type { Team } from './types.ts'

export function parseTeams(value: unknown): Team[] {
  if (!Array.isArray(value)) return []
  const teams: Team[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    if (typeof row.id !== 'string' || typeof row.name !== 'string' || typeof row.slug !== 'string') {
      continue
    }
    teams.push({ id: row.id, name: row.name, slug: row.slug })
  }
  return teams
}

export async function loadTeams(): Promise<{ teams: Team[]; error: string | null }> {
  if (!supabase) return { teams: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.from('teams').select('id, name, slug').order('slug')
  if (error) return { teams: [], error: error.message }
  return { teams: parseTeams(data), error: null }
}

export async function loadMyTeamIds(userId: string): Promise<{ ids: string[]; error: string | null }> {
  if (!supabase) return { ids: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.from('team_members').select('team_id').eq('profile_id', userId)
  if (error) return { ids: [], error: error.message }
  if (!Array.isArray(data)) return { ids: [], error: null }
  const ids: string[] = []
  for (const item of data) {
    if (!item || typeof item !== 'object') continue
    const teamId = (item as Record<string, unknown>).team_id
    if (typeof teamId === 'string') ids.push(teamId)
  }
  return { ids, error: null }
}
