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

export const ASSIGNABLE_ROLES = ['player', 'captain'] as const

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number]

export function isAssignableRole(role: ClubRole): role is AssignableRole {
  return role === 'player' || role === 'captain'
}

export type ClubMember = {
  id: string
  full_name: string | null
  email: string | null
  role: ClubRole
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

export const SCHEDULE_EVENT_TYPES = ['league_game', 'umpiring', 'practice', 'other'] as const

export type ScheduleEventType = (typeof SCHEDULE_EVENT_TYPES)[number]

export type ScheduleEvent = {
  id: string
  team_id: string | null
  umpiring_team_id: string | null
  game_date: string
  start_time: string
  end_time: string | null
  starts_at: string
  ends_at: string | null
  match_format: string | null
  ground: string
  address: string | null
  opponent: string
  event_type: ScheduleEventType
  division: string | null
  notes: string | null
  created_by: string | null
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

export const DUE_STATUSES = ['open', 'paid', 'waived', 'cancelled'] as const

export type DueStatus = (typeof DUE_STATUSES)[number]

export const CLAIM_STATUSES = ['confirmed', 'pending_claim'] as const

export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export type Expense = {
  id: string
  title: string
  amount: number
  currency: string
  expense_date: string
  category: string | null
  notes: string | null
  team_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type DuesAssessment = {
  id: string
  title: string
  description: string | null
  amount: number
  due_date: string
  period_label: string
  team_id: string | null
  member_id: string
  expense_id: string | null
  status: DueStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export type DuesPayment = {
  id: string
  assessment_id: string
  amount: number
  paid_at: string
  method_note: string | null
  recorded_by: string | null
  claim_status: ClaimStatus
  payer_user_id: string | null
  notes: string | null
  created_at: string
}

export type RosterMember = {
  id: string
  full_name: string | null
  role: ClubRole
}

export type TeamMembership = {
  team_id: string
  profile_id: string
}

export function isDueStatus(value: unknown): value is DueStatus {
  return value === 'open' || value === 'paid' || value === 'waived' || value === 'cancelled'
}

export function isClaimStatus(value: unknown): value is ClaimStatus {
  return value === 'confirmed' || value === 'pending_claim'
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
