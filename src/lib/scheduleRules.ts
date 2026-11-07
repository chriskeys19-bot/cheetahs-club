import type { ScheduleEvent, ScheduleEventType } from './types.ts'

export function eventKindLabel(type: ScheduleEventType): string {
  if (type === 'league_game') return 'League'
  if (type === 'umpiring') return 'Umpiring'
  if (type === 'practice') return 'Practice'
  return 'Other'
}

export function eventTitle(
  event: Pick<ScheduleEvent, 'event_type' | 'opponent'>,
  sideName: string | null,
): string {
  const side = sideName?.replace(/^Cheetahs /, '') ?? null
  if (event.event_type === 'umpiring') return event.opponent
  if (event.event_type === 'practice') {
    const label = event.opponent.trim()
    if (label.length > 0 && label.toLowerCase() !== 'cheetahs practice') return label
    return side ? `${side} practice` : 'Cheetahs practice'
  }
  if (event.event_type === 'other') return event.opponent
  return `${side ?? 'Club'} vs ${event.opponent}`
}

const CHEETAHS_SIDES = new Set(['alpha', 'beta', 'gamma'])

export function isCheetahsLeagueGame(event: Pick<ScheduleEvent, 'event_type' | 'team_id'>, slug: string | null): boolean {
  return event.event_type === 'league_game' && slug !== null && CHEETAHS_SIDES.has(slug)
}

/** League game with match_status completed or a posted result. A past start alone does not qualify. */
export function isCompletedLeagueListing(
  event: Pick<ScheduleEvent, 'event_type' | 'team_id' | 'match_status' | 'result'>,
  slug: string | null,
): boolean {
  if (!isCheetahsLeagueGame(event, slug)) return false
  return event.match_status === 'completed' || event.result !== null
}

/** League game still to be played: no posted result, and the start is not in the past. */
export function isUpcomingLeagueGame(
  event: Pick<ScheduleEvent, 'event_type' | 'team_id' | 'match_status' | 'result' | 'starts_at'>,
  slug: string | null,
  asOf: number,
): boolean {
  if (!isCheetahsLeagueGame(event, slug)) return false
  if (event.match_status === 'completed' || event.result !== null) return false
  const start = new Date(event.starts_at).getTime()
  return Number.isFinite(start) && start >= asOf
}

export function eventsInPacificWeek(
  events: ScheduleEvent[],
  start: string,
  end: string,
): ScheduleEvent[] {
  return events.filter((event) => {
    const day = event.game_date.slice(0, 10)
    return day >= start && day <= end
  })
}
