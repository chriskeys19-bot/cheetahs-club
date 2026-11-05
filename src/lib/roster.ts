import { supabase } from './supabase.ts'
import { isClubRole, type RosterMember } from './types.ts'

export function rosterError(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('duplicate') || lower.includes('team_members_pkey')) {
    return 'That member is already on that side.'
  }
  if (lower.includes('team_members_team_id_fkey')) return 'Choose Alpha, Beta, or Gamma.'
  if (lower.includes('team_members_profile_id_fkey')) return 'That member is no longer on the list.'
  if (
    lower.includes('staff role') ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('not authenticated') ||
    lower.includes('jwt')
  ) {
    return 'Captains and admins can change sides.'
  }
  return message
}

function parseRosterMember(value: unknown): RosterMember | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !isClubRole(row.role)) return null
  if (row.full_name !== null && row.full_name !== undefined && typeof row.full_name !== 'string') return null
  if (row.email !== null && row.email !== undefined && typeof row.email !== 'string') return null
  if (!Array.isArray(row.team_ids)) return null
  const teamIds: string[] = []
  for (const item of row.team_ids) {
    if (typeof item !== 'string') return null
    teamIds.push(item)
  }
  return {
    id: row.id,
    full_name: typeof row.full_name === 'string' ? row.full_name : null,
    email: typeof row.email === 'string' ? row.email : null,
    role: row.role,
    team_ids: teamIds,
  }
}

export function parseRoster(value: unknown): RosterMember[] {
  if (!Array.isArray(value)) return []
  return value.map(parseRosterMember).filter((member): member is RosterMember => member !== null)
}

export async function loadTeamRoster(): Promise<{ rows: RosterMember[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.rpc('list_team_roster')
  if (error) return { rows: [], error: rosterError(error.message) }
  const rows = parseRoster(data)
  if (Array.isArray(data) && rows.length !== data.length) {
    return { rows, error: 'Part of the roster could not be read.' }
  }
  return { rows, error: null }
}

export async function addToSide(input: { profileId: string; teamId: string }): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { error } = await supabase.from('team_members').insert({
    team_id: input.teamId,
    profile_id: input.profileId,
  })
  if (error) return rosterError(error.message)
  return null
}

export async function removeFromSide(input: { profileId: string; teamId: string }): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  const { data, error } = await supabase
    .from('team_members')
    .delete()
    .eq('team_id', input.teamId)
    .eq('profile_id', input.profileId)
    .select('team_id')
  if (error) return rosterError(error.message)
  if (!Array.isArray(data) || data.length === 0) return 'That member is not on that side.'
  return null
}
