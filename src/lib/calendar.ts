import { formatFixture, formatPacificDate, isoToPacificWall } from './format.ts'
import { isLeagueCompleted, kitLine, type GameResult } from './games.ts'
import { addCivilDays } from './recurrence.ts'
import { visibleText } from './richText.ts'
import { eventTitle, isCheetahsLeagueGame } from './scheduleRules.ts'
import type { Activity, DuesAssessment, Expense, Poll, ScheduleEvent, Team } from './types.ts'

/**
 * Month grid items.
 * League dots are Cheetahs Alpha, Beta, and Gamma games only.
 * Each stored activity row is one occurrence, so a series shows on every date.
 * Poll close times, the signed-in member's open or paid dues, and expenses
 * that member can already read are included. Post timestamps are not events.
 */
export const CALENDAR_KINDS = ['league', 'practice', 'activity', 'umpiring', 'other', 'poll', 'dues', 'expense'] as const

export type CalendarKind = (typeof CALENDAR_KINDS)[number]

export const CALENDAR_KIND_LABEL: Record<CalendarKind, string> = {
  league: 'League',
  practice: 'Practice',
  activity: 'Activity',
  umpiring: 'Umpiring',
  other: 'Other',
  poll: 'Poll',
  dues: 'Dues',
  expense: 'Expense',
}

export type CalendarItem = {
  id: string
  kind: CalendarKind
  date: string
  sortKey: number
  timeLabel: string
  title: string
  venue: string | null
  sideLabel: string | null
  kit: string | null
  result: GameResult | null
  showResult: boolean
  videoUrl: string | null
  href: string
}

export type MonthCell = {
  date: string
  day: number
  inMonth: boolean
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta
  const monthIndex = ((index % 12) + 12) % 12
  return { year: (index - monthIndex) / 12, month: monthIndex + 1 }
}

export function monthGrid(year: number, month: number): MonthCell[] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return []
  const first = `${year}-${pad(month)}-01`
  const weekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  const lead = weekday === 0 ? 6 : weekday - 1
  const start = addCivilDays(first, -lead)
  if (!start) return []
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const count = Math.ceil((lead + daysInMonth) / 7) * 7
  const monthKey = `${year}-${pad(month)}`
  const cells: MonthCell[] = []
  for (let index = 0; index < count; index += 1) {
    const date = addCivilDays(start, index)
    if (!date) return []
    cells.push({
      date,
      day: Number(date.slice(8, 10)),
      inMonth: date.startsWith(`${monthKey}-`),
    })
  }
  return cells
}

function civilStamp(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
}

export function civilMonth(iso: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso)
  if (!match) return null
  const month = Number(match[2])
  if (month < 1 || month > 12) return null
  return { year: Number(match[1]), month }
}

export function formatMonthTitle(year: number, month: number): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return ''
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'long',
    year: 'numeric',
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)))
}

export function formatDayHeading(iso: string): string {
  const stamp = civilStamp(iso)
  if (!stamp) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(stamp)
}

export function dayButtonLabel(iso: string, count: number, isToday: boolean): string {
  const stamp = civilStamp(iso)
  const spoken = stamp
    ? new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      }).format(stamp)
    : iso
  const today = isToday ? ', today' : ''
  const noun = count === 0 ? ', nothing scheduled' : count === 1 ? ', 1 item' : `, ${count} items`
  return `${spoken}${today}${noun}`
}

function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function clockLabel(time: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

function pacificSpan(
  startIso: string,
  endIso: string | null,
): { date: string; minutes: number; label: string } | null {
  const start = isoToPacificWall(startIso)
  const startClock = clockLabel(start.time)
  const minutes = minutesOf(start.time)
  if (!start.date || !startClock || minutes === null) return null
  if (!endIso) return { date: start.date, minutes, label: `${startClock} PT` }
  const end = isoToPacificWall(endIso)
  const endClock = clockLabel(end.time)
  if (!end.date || !endClock) return { date: start.date, minutes, label: `${startClock} PT` }
  if (end.date === start.date) {
    return { date: start.date, minutes, label: `${startClock} – ${endClock} PT` }
  }
  return {
    date: start.date,
    minutes,
    label: `${startClock} – ${endClock} PT ${formatPacificDate(end.date)}`,
  }
}

function teamById(teams: Team[], id: string | null): Team | null {
  if (!id) return null
  return teams.find((team) => team.id === id) ?? null
}

function sideLabel(team: Team | null, clubWide: boolean): string | null {
  if (!team) return clubWide ? 'Club-wide' : null
  return team.name.replace(/^Cheetahs /, '')
}

function fixtureHref(event: ScheduleEvent, slug: string | null): string {
  const hash = `#fixture-${event.id}`
  if (event.event_type === 'practice') return `/schedules?side=practice${hash}`
  if (
    event.event_type === 'league_game' &&
    (slug === 'alpha' || slug === 'beta' || slug === 'gamma')
  ) {
    return `/schedules?side=${slug}${hash}`
  }
  return `/schedules${hash}`
}

function fromSchedule(
  events: ScheduleEvent[],
  teams: Team[],
  asOf: number,
  teamsKnown: boolean,
): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const event of events) {
    const team = teamById(teams, event.team_id)
    const slug = team?.slug ?? null
    if (event.event_type === 'league_game') {
      const cheetahs = isCheetahsLeagueGame(event, slug)
      if (teamsKnown && !cheetahs) continue
      if (!teamsKnown && slug !== null && !cheetahs) continue
    }
    const kind: CalendarKind =
      event.event_type === 'league_game'
        ? 'league'
        : event.event_type === 'practice'
          ? 'practice'
          : event.event_type === 'umpiring'
            ? 'umpiring'
            : 'other'
    const when = formatFixture(event.game_date, event.start_time, event.end_time)
    items.push({
      id: `fixture-${event.id}`,
      kind,
      date: event.game_date.slice(0, 10),
      sortKey: minutesOf(event.start_time) ?? 0,
      timeLabel: when.time,
      title: eventTitle(event, team?.name ?? null),
      venue: event.ground,
      sideLabel: sideLabel(team, kind !== 'league'),
      kit: kind === 'league' ? kitLine(event, slug) : null,
      result: kind === 'league' ? event.result : null,
      showResult: kind === 'league' && (isLeagueCompleted(event, asOf) || event.result !== null),
      videoUrl: kind === 'league' ? event.video_url : null,
      href: fixtureHref(event, slug),
    })
  }
  return items
}

function fromActivities(rows: Activity[], teams: Team[]): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const row of rows) {
    const when = pacificSpan(row.starts_at, row.ends_at)
    if (!when) continue
    const team = teamById(teams, row.team_id)
    const title = visibleText(row.title)
    items.push({
      id: `activity-${row.id}`,
      kind: 'activity',
      date: when.date,
      sortKey: when.minutes,
      timeLabel: when.label,
      title: title || 'Activity',
      venue: row.location,
      sideLabel: sideLabel(team, true),
      kit: null,
      result: null,
      showResult: false,
      videoUrl: null,
      href: `/activities#activity-${row.id}`,
    })
  }
  return items
}

function fromPolls(rows: Poll[]): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const poll of rows) {
    if (!poll.closes_at) continue
    const when = pacificSpan(poll.closes_at, null)
    if (!when) continue
    const title = visibleText(poll.question)
    items.push({
      id: `poll-${poll.id}`,
      kind: 'poll',
      date: when.date,
      sortKey: when.minutes,
      timeLabel: `Closes ${when.label}`,
      title: title || 'Poll',
      venue: null,
      sideLabel: null,
      kit: null,
      result: null,
      showResult: false,
      videoUrl: null,
      href: `/polls#poll-${poll.id}`,
    })
  }
  return items
}

function fromDues(rows: DuesAssessment[], teams: Team[]): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const row of rows) {
    if (row.status !== 'open' && row.status !== 'paid') continue
    const team = teamById(teams, row.team_id)
    items.push({
      id: `due-${row.id}`,
      kind: 'dues',
      date: row.due_date.slice(0, 10),
      sortKey: -1,
      timeLabel: row.status === 'paid' ? 'Paid' : 'Due',
      title: row.title,
      venue: null,
      sideLabel: sideLabel(team, false),
      kit: null,
      result: null,
      showResult: false,
      videoUrl: null,
      href: `/dues#due-${row.id}`,
    })
  }
  return items
}

function fromExpenses(rows: Expense[], teams: Team[]): CalendarItem[] {
  const items: CalendarItem[] = []
  for (const row of rows) {
    if (row.archived_at) continue
    const team = teamById(teams, row.team_id)
    items.push({
      id: `expense-${row.id}`,
      kind: 'expense',
      date: row.expense_date.slice(0, 10),
      sortKey: -1,
      timeLabel: 'All day',
      title: row.title,
      venue: null,
      sideLabel: sideLabel(team, false),
      kit: null,
      result: null,
      showResult: false,
      videoUrl: null,
      href: `/dues#expense-${row.id}`,
    })
  }
  return items
}

export function buildCalendarItems(input: {
  events: ScheduleEvent[]
  activities: Activity[]
  polls: Poll[]
  dues: DuesAssessment[]
  expenses: Expense[]
  teams: Team[]
  asOf: number
  teamsKnown: boolean
}): CalendarItem[] {
  return [
    ...fromSchedule(input.events, input.teams, input.asOf, input.teamsKnown),
    ...fromActivities(input.activities, input.teams),
    ...fromPolls(input.polls),
    ...fromDues(input.dues, input.teams),
    ...fromExpenses(input.expenses, input.teams),
  ]
}

export function groupCalendarItems(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>()
  for (const item of items) {
    const list = grouped.get(item.date)
    if (list) list.push(item)
    else grouped.set(item.date, [item])
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.sortKey - b.sortKey || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  }
  return grouped
}

export function dotsForDay(items: CalendarItem[]): CalendarKind[] {
  const present = new Set(items.map((item) => item.kind))
  return CALENDAR_KINDS.filter((kind) => present.has(kind))
}
