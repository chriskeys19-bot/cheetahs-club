import type { ScheduleEvent } from './types.ts'

export const VENUE_SIDES = ['home', 'away'] as const
export const BALL_COLORS = ['white', 'pink'] as const
export const DRESS_CODES = ['cheetahs_colors', 'whites'] as const
export const GAME_RESULTS = ['win', 'loss', 'draw', 'nr'] as const
export const MATCH_STATUSES = ['scheduled', 'completed'] as const

export type VenueSide = (typeof VENUE_SIDES)[number]
export type BallColor = (typeof BALL_COLORS)[number]
export type DressCode = (typeof DRESS_CODES)[number]
export type GameResult = (typeof GAME_RESULTS)[number]
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export function isVenueSide(value: string): value is VenueSide {
  return value === 'home' || value === 'away'
}

export function isBallColor(value: string): value is BallColor {
  return value === 'white' || value === 'pink'
}

export function isDressCode(value: string): value is DressCode {
  return value === 'cheetahs_colors' || value === 'whites'
}

export function isGameResult(value: string): value is GameResult {
  return value === 'win' || value === 'loss' || value === 'draw' || value === 'nr'
}

export function isMatchStatus(value: string): value is MatchStatus {
  return value === 'scheduled' || value === 'completed'
}

export function defaultKit(slug: string | null): { ball: BallColor; dress: DressCode } | null {
  if (slug === 'alpha' || slug === 'beta') return { ball: 'white', dress: 'cheetahs_colors' }
  if (slug === 'gamma') return { ball: 'pink', dress: 'whites' }
  return null
}

export function ballLabel(ball: BallColor): string {
  return ball === 'white' ? 'White Ball' : 'Pink Ball'
}

export function dressLabel(dress: DressCode): string {
  return dress === 'cheetahs_colors' ? 'Cheetahs Colors' : 'Whites'
}

export function venueLabel(side: VenueSide | null): string {
  if (side === 'home') return 'Home'
  if (side === 'away') return 'Away'
  return '—'
}

export function resultLabel(result: GameResult | null): string {
  if (result === 'win') return 'Win'
  if (result === 'loss') return 'Loss'
  if (result === 'draw') return 'Draw'
  if (result === 'nr') return 'No result'
  return 'Result not posted'
}

export function effectiveKit(
  event: Pick<ScheduleEvent, 'event_type' | 'ball_color' | 'dress_code'>,
  slug: string | null,
): { ball: BallColor | null; dress: DressCode | null } {
  if (event.event_type !== 'league_game') {
    return { ball: event.ball_color, dress: event.dress_code }
  }
  const fallback = defaultKit(slug)
  return {
    ball: event.ball_color ?? fallback?.ball ?? null,
    dress: event.dress_code ?? fallback?.dress ?? null,
  }
}

export function kitLine(
  event: Pick<ScheduleEvent, 'event_type' | 'ball_color' | 'dress_code'>,
  slug: string | null,
): string | null {
  if (event.event_type !== 'league_game') return null
  const kit = effectiveKit(event, slug)
  const parts: string[] = []
  if (kit.ball) parts.push(ballLabel(kit.ball))
  if (kit.dress) parts.push(`Dress: ${dressLabel(kit.dress)}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function isLeagueCompleted(
  event: Pick<ScheduleEvent, 'event_type' | 'match_status' | 'starts_at'>,
  asOf: number | null,
): boolean {
  if (event.event_type !== 'league_game') return false
  if (event.match_status === 'completed') return true
  if (asOf === null) return false
  return new Date(event.starts_at).getTime() < asOf
}

export function parseScorecardUrl(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 500) return 'invalid'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  const host = url.hostname.toLowerCase()
  const cricclubs = host === 'cricclubs.com' || host.endsWith('.cricclubs.com')
  if (url.protocol !== 'https:' || !cricclubs) return 'invalid'
  return trimmed
}
