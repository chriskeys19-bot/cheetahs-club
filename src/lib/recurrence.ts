export const CADENCES = ['daily', 'weekly', 'biweekly', 'monthly'] as const

export type Cadence = (typeof CADENCES)[number]

export const MAX_SERIES_OCCURRENCES = 52

export const CADENCE_LABEL: Record<Cadence, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
}

export type SeriesEnd =
  | { kind: 'count'; count: number }
  | { kind: 'until'; until: string }

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

function parts(iso: string): { year: number; month: number; day: number } | null {
  const match = ISO_DATE.exec(iso)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const probe = new Date(Date.UTC(year, month - 1, day))
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null
  }
  return { year, month, day }
}

function formatParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function isCadence(value: string): value is Cadence {
  return value === 'daily' || value === 'weekly' || value === 'biweekly' || value === 'monthly'
}

export function addCivilDays(iso: string, days: number): string | null {
  const date = parts(iso)
  if (!date || !Number.isInteger(days)) return null
  const stamp = new Date(Date.UTC(date.year, date.month - 1, date.day))
  stamp.setUTCDate(stamp.getUTCDate() + days)
  return formatParts(stamp.getUTCFullYear(), stamp.getUTCMonth() + 1, stamp.getUTCDate())
}

export function civilDayOffset(from: string, to: string): number | null {
  const start = parts(from)
  const end = parts(to)
  if (!start || !end) return null
  const startStamp = Date.UTC(start.year, start.month - 1, start.day)
  const endStamp = Date.UTC(end.year, end.month - 1, end.day)
  return Math.round((endStamp - startStamp) / 86_400_000)
}

function lastDayOfMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function addCivilMonths(iso: string, months: number): string | null {
  const date = parts(iso)
  if (!date || !Number.isInteger(months)) return null
  const monthIndex = date.month - 1 + months
  const year = date.year + Math.floor(monthIndex / 12)
  const month = ((monthIndex % 12) + 12) % 12
  const day = Math.min(date.day, lastDayOfMonth(year, month + 1))
  return formatParts(year, month + 1, day)
}

export function occurrenceDate(start: string, index: number, cadence: Cadence): string | null {
  if (!Number.isInteger(index) || index < 0) return null
  if (cadence === 'daily') return addCivilDays(start, index)
  if (cadence === 'weekly') return addCivilDays(start, index * 7)
  if (cadence === 'biweekly') return addCivilDays(start, index * 14)
  return addCivilMonths(start, index)
}

const TOO_MANY =
  'That range would create more than 52 occurrences. Shorten the end date, or use a count of 52 or fewer.'

/**
 * Expand a Pacific civil-date series. The first date is the start date.
 * Count includes the first date. An end date is inclusive.
 * Steps are taken from the original start, so a 31st monthly series clamps
 * only the short months (31 Jan, 28 Feb, 31 Mar).
 */
export function expandCadence(
  start: string,
  cadence: Cadence,
  end: SeriesEnd,
): { dates: string[] } | { error: string } {
  if (!parts(start)) return { error: 'Choose a valid start date.' }
  if (end.kind === 'count') {
    if (!Number.isInteger(end.count) || end.count < 1) {
      return { error: 'Enter a whole number of occurrences from 1 to 52.' }
    }
    if (end.count > MAX_SERIES_OCCURRENCES) return { error: TOO_MANY }
    const dates: string[] = []
    for (let index = 0; index < end.count; index += 1) {
      const day = occurrenceDate(start, index, cadence)
      if (!day) return { error: 'Choose a valid start date.' }
      dates.push(day)
    }
    return { dates }
  }
  if (!parts(end.until)) return { error: 'Choose an end date.' }
  if (end.until < start) return { error: 'The end date has to be on or after the first date.' }
  const dates: string[] = []
  for (let index = 0; index <= MAX_SERIES_OCCURRENCES; index += 1) {
    const day = occurrenceDate(start, index, cadence)
    if (!day) return { error: 'Choose a valid start date.' }
    if (day > end.until) break
    if (dates.length === MAX_SERIES_OCCURRENCES) return { error: TOO_MANY }
    dates.push(day)
  }
  if (dates.length === 0) return { error: 'The end date has to be on or after the first date.' }
  return { dates }
}
