import { supabase } from './supabase.ts'
import { isClubRole, type AssignableRole, type ClubMember, type ClubRole } from './types.ts'

const ROLE_ORDER: Record<ClubRole, number> = {
  admin: 0,
  captain: 1,
  player: 2,
}

export function memberError(message: string, action: 'list' | 'save'): string {
  const lower = message.toLowerCase()
  if (lower.includes('cannot remove the last admin')) {
    return 'The last admin has to stay an admin.'
  }
  if (lower.includes('cannot change your own role')) {
    return 'You cannot change your own role.'
  }
  if (lower.includes('member not found')) return 'That member is no longer on the list.'
  if (lower.includes('invalid role')) return 'Choose player or captain.'
  if (
    lower.includes('admin role required') ||
    lower.includes('row-level security') ||
    lower.includes('permission denied') ||
    lower.includes('not authenticated') ||
    lower.includes('jwt')
  ) {
    return action === 'list'
      ? 'Only an admin can see the member list.'
      : 'Only an admin can change club roles.'
  }
  return message
}

function memberName(member: ClubMember): string {
  const name = member.full_name?.trim()
  if (name) return name.toLowerCase()
  return (member.email ?? member.id).toLowerCase()
}

export function compareMembers(a: ClubMember, b: ClubMember): number {
  const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role]
  if (byRole !== 0) return byRole
  return memberName(a).localeCompare(memberName(b))
}

function parseMember(value: unknown): ClubMember | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.id !== 'string' || !isClubRole(row.role)) return null
  if (row.full_name !== null && row.full_name !== undefined && typeof row.full_name !== 'string') return null
  if (row.email !== null && row.email !== undefined && typeof row.email !== 'string') return null
  return {
    id: row.id,
    full_name: typeof row.full_name === 'string' ? row.full_name : null,
    email: typeof row.email === 'string' ? row.email : null,
    role: row.role,
  }
}

export function parseMembers(value: unknown): ClubMember[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseMember)
    .filter((member): member is ClubMember => member !== null)
    .sort(compareMembers)
}

export async function loadMembers(): Promise<{ rows: ClubMember[]; error: string | null }> {
  if (!supabase) return { rows: [], error: 'Supabase is not configured.' }
  const { data, error } = await supabase.rpc('list_club_members')
  if (error) return { rows: [], error: memberError(error.message, 'list') }
  return { rows: parseMembers(data), error: null }
}

export async function setMemberRole(input: {
  targetId: string
  role: AssignableRole
  actorId: string
}): Promise<{ role: ClubRole | null; error: string | null }> {
  if (!supabase) return { role: null, error: 'Supabase is not configured.' }
  if (input.targetId === input.actorId) {
    return { role: null, error: 'You cannot change your own role.' }
  }
  const { data, error } = await supabase.rpc('set_member_role', {
    target_id: input.targetId,
    new_role: input.role,
  })
  if (error) return { role: null, error: memberError(error.message, 'save') }
  const row = parseMembers(Array.isArray(data) ? data : [data])[0]
  if (!row || !isClubRole(row.role)) {
    return { role: null, error: 'The role was saved but could not be read back.' }
  }
  return { role: row.role, error: null }
}
