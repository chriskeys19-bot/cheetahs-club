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

export function canManageClub(role: ClubRole | null | undefined): boolean {
  return role === 'admin' || role === 'captain'
}

export const INVITE_STATUSES = ['pending', 'accepted', 'revoked', 'expired'] as const

export type InviteStatus = (typeof INVITE_STATUSES)[number]

export type ClubInvite = {
  id: string
  email: string
  token: string
  team_id: string | null
  status: InviteStatus
  expires_at: string
  created_at: string
}

export function isInviteStatus(value: unknown): value is InviteStatus {
  return value === 'pending' || value === 'accepted' || value === 'revoked' || value === 'expired'
}

export const JOIN_SITE = 'https://cheetahs-club.pages.dev'

export function joinUrl(token: string): string {
  return `${JOIN_SITE}/join/${token}`
}

export type Announcement = {
  id: string
  title: string
  body: string
  author_id: string | null
  pinned: boolean
  created_at: string
  updated_at: string
}

export type Activity = {
  id: string
  title: string
  description: string | null
  starts_at: string
  ends_at: string | null
  location: string | null
  team_id: string | null
  created_by: string | null
  created_at: string
}

export type ScheduleEventType = 'league_game' | 'umpiring'

export type ScheduleEvent = {
  id: string
  team_id: string | null
  umpiring_team_id: string | null
  game_date: string
  start_time: string
  starts_at: string
  match_format: string | null
  ground: string
  address: string | null
  opponent: string
  event_type: ScheduleEventType
  division: string | null
  notes: string | null
}

export type PollStatus = 'open' | 'closed'

export type Poll = {
  id: string
  question: string
  description: string | null
  created_by: string | null
  created_at: string
  closes_at: string | null
  status: PollStatus
}

export type PollOption = {
  id: string
  poll_id: string
  label: string
  sort_order: number
}

export type PollTally = {
  poll_id: string
  option_id: string
  votes: number
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
