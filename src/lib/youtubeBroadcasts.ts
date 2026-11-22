export const START_CONFIRM_LEAD_MS = 15 * 60 * 1000
export const RECENT_ENDED_MS = 14 * 24 * 60 * 60 * 1000
export const CHICAGO = 'America/Chicago'
export const PACIFIC = 'America/Los_Angeles'

export type BroadcastFilter = 'upcoming' | 'live' | 'ended'

export type BroadcastRow = {
  id: string
  title: string
  scheduledStart: string | null
  actualStart: string | null
  actualEnd: string | null
  lifeCycle: string
  streamKeyName: string | null
  watchUrl: string
}

export type BroadcastConnection = {
  connected: boolean
  needsReconnect: boolean
  channelId: string | null
  channelTitle: string | null
  connectedAt: string | null
  message: string | null
}

export function startNeedsConfirm(scheduledStart: string | null, now: number): boolean {
  if (!scheduledStart) return true
  const start = Date.parse(scheduledStart)
  if (!Number.isFinite(start)) return true
  return start - now > START_CONFIRM_LEAD_MS
}

export function canStartBroadcast(lifeCycle: string): boolean {
  return lifeCycle === 'created' || lifeCycle === 'ready' || lifeCycle === 'testing' || lifeCycle === 'testStarting'
}

export function canEndBroadcast(lifeCycle: string): boolean {
  return lifeCycle === 'live' || lifeCycle === 'liveStarting' || lifeCycle === 'testing' || lifeCycle === 'testStarting'
}

export function displayStatus(lifeCycle: string): 'upcoming' | 'live' | 'ended' {
  if (lifeCycle === 'live' || lifeCycle === 'liveStarting') return 'live'
  if (lifeCycle === 'complete' || lifeCycle === 'revoked') return 'ended'
  return 'upcoming'
}

export function lifeCycleLabel(lifeCycle: string): string {
  if (lifeCycle === 'created' || lifeCycle === 'ready') return 'Upcoming'
  if (lifeCycle === 'testStarting') return 'Starting test'
  if (lifeCycle === 'testing') return 'Testing'
  if (lifeCycle === 'liveStarting') return 'Going live'
  if (lifeCycle === 'live') return 'Live'
  if (lifeCycle === 'complete') return 'Ended'
  if (lifeCycle === 'revoked') return 'Revoked'
  return 'Upcoming'
}

export function looksLikePulsePlay(title: string, streamKeyName: string | null): boolean {
  return /\bPSD\b|pulse\s*play/i.test(`${title} ${streamKeyName ?? ''}`)
}

export type ZonedClock = {
  dayKey: string
  dayLabel: string
  timeLabel: string
}

export function zonedClock(iso: string, timeZone: string): ZonedClock | null {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return null
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  }).formatToParts(date)
  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value
  }
  if (!map.year || !map.month || !map.day || !map.weekday || !map.hour || !map.minute) return null
  const monthNumber = new Intl.DateTimeFormat('en-US', { timeZone, month: '2-digit' }).format(date)
  const dayNumber = new Intl.DateTimeFormat('en-US', { timeZone, day: '2-digit' }).format(date)
  return {
    dayKey: `${map.year}-${monthNumber}-${dayNumber}`,
    dayLabel: `${map.weekday}, ${map.month} ${map.day}`,
    timeLabel: `${map.hour}:${map.minute} ${map.dayPeriod ?? ''} ${map.timeZoneName ?? ''}`.replace(/\s+/g, ' ').trim(),
  }
}

function chicagoDay(iso: string | null): string | null {
  if (!iso) return null
  return zonedClock(iso, CHICAGO)?.dayKey ?? null
}

export function matchesFilter(row: BroadcastRow, filter: BroadcastFilter, now: number): boolean {
  const status = displayStatus(row.lifeCycle)
  if (filter === 'live') return status === 'live'
  if (filter === 'ended') {
    if (status !== 'ended') return false
    const stamp = Date.parse(row.actualEnd ?? row.scheduledStart ?? '')
    if (!Number.isFinite(stamp)) return false
    const age = now - stamp
    return age <= RECENT_ENDED_MS && age >= -60 * 60 * 1000
  }
  if (status === 'ended') return false
  if (status === 'live') return true
  const day = chicagoDay(row.scheduledStart)
  const today = chicagoDay(new Date(now).toISOString())
  if (!day || !today) return true
  return day >= today
}

export type BroadcastGroup = {
  dayKey: string
  dayLabel: string
  rows: BroadcastRow[]
}

function sortTime(row: BroadcastRow): number {
  const stamp = Date.parse(row.scheduledStart ?? row.actualStart ?? row.actualEnd ?? '')
  return Number.isFinite(stamp) ? stamp : Number.POSITIVE_INFINITY
}

export function groupBroadcasts(rows: BroadcastRow[], filter: BroadcastFilter, now: number): BroadcastGroup[] {
  const visible = rows.filter((row) => matchesFilter(row, filter, now))
  const groups = new Map<string, BroadcastGroup>()
  for (const row of visible) {
    const clock = row.scheduledStart ? zonedClock(row.scheduledStart, CHICAGO) : null
    const dayKey = clock?.dayKey ?? 'unscheduled'
    const dayLabel = clock?.dayLabel ?? 'No scheduled time'
    const group = groups.get(dayKey) ?? { dayKey, dayLabel, rows: [] }
    group.rows.push(row)
    groups.set(dayKey, group)
  }
  const ordered = [...groups.values()]
  const direction = filter === 'ended' ? -1 : 1
  ordered.sort((left, right) => {
    if (left.dayKey === 'unscheduled') return 1
    if (right.dayKey === 'unscheduled') return -1
    return left.dayKey < right.dayKey ? -direction : direction
  })
  for (const group of ordered) {
    group.rows.sort((left, right) => (sortTime(left) - sortTime(right)) * direction)
  }
  return ordered
}

export function startConfirmCopy(row: Pick<BroadcastRow, 'title' | 'scheduledStart' | 'streamKeyName'>): {
  title: string
  body: string
} {
  const when = row.scheduledStart ? (zonedClock(row.scheduledStart, CHICAGO)?.timeLabel ?? 'an unknown time') : 'an unknown time'
  const day = row.scheduledStart ? zonedClock(row.scheduledStart, CHICAGO)?.dayLabel : null
  const key = row.streamKeyName?.trim() || 'no stream key name on file'
  const schedule = day ? `${day} at ${when}` : when
  return {
    title: 'Start this stream early?',
    body: `Start ${row.title} now? It is scheduled for ${schedule}. Stream key: ${key}.`,
  }
}

export function endConfirmCopy(row: Pick<BroadcastRow, 'title'>): { title: string; body: string } {
  return {
    title: 'End this stream?',
    body: `End ${row.title} on YouTube? The broadcast will stop for viewers.`,
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseBroadcastRow(value: unknown): BroadcastRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = text(row.id)
  const watchUrl = text(row.watchUrl)
  const lifeCycle = text(row.lifeCycle)
  if (!id || !watchUrl || !lifeCycle) return null
  if (!watchUrl.startsWith('https://www.youtube.com/watch?v=')) return null
  return {
    id,
    title: text(row.title) ?? 'Untitled broadcast',
    scheduledStart: text(row.scheduledStart),
    actualStart: text(row.actualStart),
    actualEnd: text(row.actualEnd),
    lifeCycle,
    streamKeyName: text(row.streamKeyName),
    watchUrl,
  }
}

export function parseBroadcastRows(value: unknown): BroadcastRow[] {
  if (!value || typeof value !== 'object') return []
  const rows = (value as { broadcasts?: unknown }).broadcasts
  if (!Array.isArray(rows)) return []
  const parsed: BroadcastRow[] = []
  for (const row of rows) {
    const item = parseBroadcastRow(row)
    if (item) parsed.push(item)
  }
  return parsed
}

export function parseConnection(value: unknown): BroadcastConnection | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (typeof row.connected !== 'boolean') return null
  return {
    connected: row.connected,
    needsReconnect: row.needsReconnect === true,
    channelId: text(row.channelId),
    channelTitle: text(row.channelTitle),
    connectedAt: text(row.connectedAt),
    message: text(row.message),
  }
}

export function oauthFlagMessage(reason: string | null, connected: boolean): string {
  if (connected) return 'YouTube is connected.'
  if (reason === 'denied') return 'Google sign-in was cancelled before YouTube was connected.'
  if (reason === 'state') return 'That connection link expired or was already used. Press Connect YouTube again.'
  if (reason === 'channel') {
    return 'YouTube did not return a channel for this account. Connect the CricketCrazeUSA account and try again.'
  }
  if (reason === 'missing_refresh') {
    return 'Google did not return a refresh token. Press Reconnect and accept the consent screen.'
  }
  if (reason === 'config') return 'YouTube OAuth is not configured yet. An admin still needs to set the YouTube client secrets.'
  if (reason === 'forbidden') return 'Only an admin can connect YouTube.'
  return 'YouTube could not be connected. Press Connect YouTube again.'
}
