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

export function formatFixture(gameDate: string, startTime: string): { date: string; time: string } {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(gameDate)
  const timeMatch = /^(\d{2}):(\d{2})/.exec(startTime)
  if (!dateMatch || !timeMatch) return { date: gameDate, time: startTime }
  const year = Number(dateMatch[1])
  const month = Number(dateMatch[2])
  const day = Number(dateMatch[3])
  const hour = Number(timeMatch[1])
  const minute = Number(timeMatch[2])
  const utcNoon = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(utcNoon)
  const hour12 = hour % 12 === 0 ? 12 : hour % 12
  const suffix = hour >= 12 ? 'PM' : 'AM'
  return { date, time: `${hour12}:${String(minute).padStart(2, '0')} ${suffix} PT` }
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
