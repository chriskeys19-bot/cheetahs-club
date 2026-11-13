import type { GameResult } from './games.ts'

/** How many completed results appear in the form, oldest on the left. */
export const FORM_LIMIT = 5

/**
 * A schedule row the record can read. `schedule_events` has no season column,
 * so every league game in the rows passed in counts. Callers pass the games
 * already loaded for the winter list.
 */
export type RecordEvent = {
  id: string
  team_id: string | null
  event_type: string
  result: GameResult | null
  match_status: string
  game_date: string
  start_time: string
  opponent: string
}

export type RecordTeam = {
  id: string
  name: string
  slug: string
}

export type FormMark = {
  id: string
  result: GameResult
  letter: 'W' | 'L' | 'T' | 'NR'
  label: string
}

export type TeamSeasonRecord = {
  teamId: string
  slug: string
  name: string
  shortName: string
  wins: number
  losses: number
  tiesOrNr: number
  toPlay: number
  form: FormMark[]
}

export type RecordPart = {
  key: 'wins' | 'losses' | 'ties' | 'toPlay'
  text: string
}

const CHEETAHS_PREFIX = /^Cheetahs\s+/i

export function teamShortName(name: string): string {
  const short = name.replace(CHEETAHS_PREFIX, '').trim()
  return short.length > 0 ? short : name
}

function formLetter(result: GameResult): FormMark['letter'] {
  if (result === 'win') return 'W'
  if (result === 'loss') return 'L'
  if (result === 'draw') return 'T'
  return 'NR'
}

/** "Nov 8" from a date-only string, without shifting the calendar day. */
export function formDateLabel(gameDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameDate)
  if (!match) return gameDate
  const utc = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(utc)
}

export function formBadgeLabel(result: GameResult, opponent: string, gameDate: string): string {
  const letter = formLetter(result)
  const date = formDateLabel(gameDate)
  const versus = opponent.trim()
  if (versus.length > 0) return `${letter} vs ${versus}, ${date}`
  return `${letter}, ${date}`
}

function eventOrder(a: RecordEvent, b: RecordEvent): number {
  const date = a.game_date.slice(0, 10).localeCompare(b.game_date.slice(0, 10))
  if (date !== 0) return date
  const time = a.start_time.localeCompare(b.start_time)
  if (time !== 0) return time
  return a.id.localeCompare(b.id)
}

function isLeagueGame(event: RecordEvent): event is RecordEvent & { team_id: string } {
  return event.event_type === 'league_game' && event.team_id !== null
}

/**
 * One record per club team, in the order `teams` is given.
 * League games only. A posted result counts as W, L, or T/NR.
 * To play is a league game with no result whose match is not completed
 * (`scheduled`, `in_progress`, and any other non-completed status).
 */
export function buildTeamRecords(teams: RecordTeam[], events: RecordEvent[]): TeamSeasonRecord[] {
  const byTeam = new Map<string, RecordEvent[]>()
  for (const event of events) {
    if (!isLeagueGame(event)) continue
    const list = byTeam.get(event.team_id)
    if (list) list.push(event)
    else byTeam.set(event.team_id, [event])
  }

  return teams.map((team) => {
    const games = (byTeam.get(team.id) ?? []).slice().sort(eventOrder)
    let wins = 0
    let losses = 0
    let tiesOrNr = 0
    let toPlay = 0
    const decided: RecordEvent[] = []
    for (const game of games) {
      if (game.result === 'win' || game.result === 'loss' || game.result === 'draw' || game.result === 'nr') {
        if (game.result === 'win') wins += 1
        else if (game.result === 'loss') losses += 1
        else tiesOrNr += 1
        decided.push(game)
        continue
      }
      if (game.match_status !== 'completed') toPlay += 1
    }
    const form = decided.slice(-FORM_LIMIT).map((game) => {
      const result = game.result as GameResult
      return {
        id: game.id,
        result,
        letter: formLetter(result),
        label: formBadgeLabel(result, game.opponent, game.game_date),
      }
    })
    return {
      teamId: team.id,
      slug: team.slug,
      name: team.name,
      shortName: teamShortName(team.name),
      wins,
      losses,
      tiesOrNr,
      toPlay,
      form,
    }
  })
}

export function recordParts(
  record: Pick<TeamSeasonRecord, 'wins' | 'losses' | 'tiesOrNr' | 'toPlay'>,
): RecordPart[] {
  const parts: RecordPart[] = [
    { key: 'wins', text: `${record.wins} W` },
    { key: 'losses', text: `${record.losses} L` },
  ]
  if (record.tiesOrNr > 0) parts.push({ key: 'ties', text: `${record.tiesOrNr} T/NR` })
  parts.push({ key: 'toPlay', text: `${record.toPlay} to play` })
  return parts
}

export function recordSummary(
  record: Pick<TeamSeasonRecord, 'wins' | 'losses' | 'tiesOrNr' | 'toPlay'>,
): string {
  return recordParts(record).map((part) => part.text).join(' · ')
}

export type RecordFilter =
  | 'all'
  | 'upcoming'
  | 'completed'
  | 'alpha'
  | 'beta'
  | 'gamma'
  | 'practice'
  | 'mine'

/** Team chips narrow the strip. Upcoming, completed, all, and practice keep every side. */
export function recordsForSide(
  records: TeamSeasonRecord[],
  side: RecordFilter,
  myTeamIds: readonly string[],
): TeamSeasonRecord[] {
  if (side === 'alpha' || side === 'beta' || side === 'gamma') {
    return records.filter((record) => record.slug === side)
  }
  if (side === 'mine') {
    const mine = new Set(myTeamIds)
    return records.filter((record) => mine.has(record.teamId))
  }
  return records
}
