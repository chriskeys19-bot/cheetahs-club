import { buildCalendarItems, monthGrid, type CalendarItem } from './calendar.ts'
import { loadActivities } from './activities.ts'
import { loadExpensesBetween, loadOwnDuesBetween } from './dues.ts'
import { pacificWallToIso } from './format.ts'
import { loadPollsClosingBetween } from './polls.ts'
import { addCivilDays } from './recurrence.ts'
import { loadScheduleBetween } from './schedules.ts'
import { loadTeams } from './teams.ts'

function firstError(messages: Array<string | null>): string | null {
  const errors = messages.filter((message): message is string => Boolean(message))
  return errors.length > 0 ? errors.join(' ') : null
}

/** Read-only month load. Each query uses the signed-in client, so RLS still applies. */
export async function loadMonthCalendar(
  year: number,
  month: number,
  userId: string,
): Promise<{ items: CalendarItem[]; error: string | null }> {
  const cells = monthGrid(year, month)
  const from = cells[0]?.date
  const to = cells[cells.length - 1]?.date
  const next = to ? addCivilDays(to, 1) : null
  const fromIso = from ? pacificWallToIso(from, '00:00') : null
  const toIso = next ? pacificWallToIso(next, '00:00') : null
  if (!from || !to || !fromIso || !toIso) return { items: [], error: 'That month could not be shown.' }

  const [teams, events, activities, polls, dues, expenses] = await Promise.all([
    loadTeams(),
    loadScheduleBetween(from, to),
    loadActivities({ from: fromIso, to: toIso, limit: 500 }),
    loadPollsClosingBetween(fromIso, toIso),
    loadOwnDuesBetween(userId, from, to),
    loadExpensesBetween(from, to),
  ])

  return {
    items: buildCalendarItems({
      events: events.rows,
      activities: activities.rows,
      polls: polls.rows,
      dues: dues.rows,
      expenses: expenses.rows,
      teams: teams.teams,
      asOf: Date.now(),
      teamsKnown: teams.error === null,
    }),
    error: firstError([teams.error, events.error, activities.error, polls.error, dues.error, expenses.error]),
  }
}
