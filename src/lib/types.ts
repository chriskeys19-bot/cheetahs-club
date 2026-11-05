export const CLUB_ROLES = ['admin', 'captain', 'player'] as const

export type ClubRole = (typeof CLUB_ROLES)[number]

export type Profile = {
  id: string
  full_name: string | null
  role: ClubRole
}

export type Team = {
  id: string
  name: string
  slug: string
}

export type FeedbackRow = {
  id: string
  user_id: string
  submitter_name: string | null
  submitter_email: string | null
  role: string | null
  body: string
  created_at: string
}

export function isClubRole(value: unknown): value is ClubRole {
  return value === 'admin' || value === 'captain' || value === 'player'
}

export function roleLabel(role: ClubRole): string {
  if (role === 'admin') return 'Admin'
  if (role === 'captain') return 'Captain'
  return 'Player'
}

export function displayName(profile: Profile | null, email: string | null | undefined): string {
  const name = profile?.full_name?.trim()
  if (name) return name
  if (email) {
    const local = email.split('@')[0]?.trim()
    if (local) return local
  }
  return 'Member'
}
