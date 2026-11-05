const PACIFIC = 'America/Los_Angeles'

export function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatPacific(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(date)
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
}

function formatClock(time: string): string | null {
  const timeMatch = /^(\d{2}):(\d{2})/.exec(time)
  if (!timeMatch) return null
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatFixture(
  gameDate: string,
  startTime: string,
  endTime?: string | null,
): { date: string; time: string } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameDate)
  const start = formatClock(startTime)
  if (!dateMatch || !start) return { date: gameDate, time: startTime }
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(utcNoon)
  const end = endTime ? formatClock(endTime) : null
  const time = end ? `${start} – ${end} PT` : `${start} PT`
  return { date, time }
}

function pacificParts(date: Date): { year: number; month: number; day: number; weekday: number } | null {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  })
  const map: Record<string, string> = {}
  for (const part of formatter.formatToParts(date)) {
    if (part.type === 'literal') continue
    map[part.type] = part.value
  }
  const weekday = WEEKDAY_INDEX[map.weekday ?? '']
  if (!map.year || !map.month || !map.day || weekday === undefined) return null
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday,
  }
}

function isoDateUtc(year: number, month: number, day: number): string {
  return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10)
}

/**
 * Monday–Sunday calendar week in America/Los_Angeles.
 * Bounds are inclusive YYYY-MM-DD civil dates, compared with schedule game_date.
 */
export function pacificWeekBounds(now = new Date()): { start: string; end: string } {
  const parts = pacificParts(now)
  if (!parts) {
    const fallback = now.toISOString().slice(0, 10)
    return { start: fallback, end: fallback }
  }
  const daysFromMonday = parts.weekday === 0 ? 6 : parts.weekday - 1
  const monday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  monday.setUTCDate(monday.getUTCDate() - daysFromMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(sunday.getUTCDate() + 6)
  return {
    start: isoDateUtc(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate()),
    end: isoDateUtc(sunday.getUTCFullYear(), sunday.getUTCMonth() + 1, sunday.getUTCDate()),
  }
}

export function formatPacificDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return isoDate
  const stamp = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12))
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(stamp)
}

export function pacificWallToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  if (!year || !month || !day || Number.isNaN(hour) || Number.isNaN(minute)) return null
  const utcMillis = Date.UTC(year, month - 1, day, hour, minute, 0)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const map: Record<string, number> = {}
  for (const part of formatter.formatToParts(new Date(utcMillis))) {
    if (part.type === 'literal') continue
    map[part.type] = Number(part.value)
  }
  if (map.year === undefined || map.month === undefined || map.day === undefined) return null
  const hourPart = map.hour === 24 ? 0 : map.hour
  const zonedAsUtc = Date.UTC(map.year, map.month - 1, map.day, hourPart, map.minute ?? 0, map.second ?? 0)
  const offset = zonedAsUtc - utcMillis
  return new Date(utcMillis - offset).toISOString()
}
