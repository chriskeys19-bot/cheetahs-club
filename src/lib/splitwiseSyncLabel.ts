export type SplitwiseSyncSource = 'scheduled' | 'manual' | 'service'

export type SplitwiseSyncStamp = {
  syncedAt: string | null
  lastAttemptFailed: boolean
  lastAttemptAt?: string | null
  groupName?: string | null
  timeZone?: string
}

function normalizeSpaces(value: string): string {
  return value.replace(/[\u202f\u00a0]/g, ' ')
}

/** Viewer's local zone when timeZone is omitted. */
export function formatLocalDateTime(iso: string, timeZone?: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }
  if (timeZone) options.timeZone = timeZone
  return normalizeSpaces(new Intl.DateTimeFormat('en-US', options).format(date))
}

export function splitwiseSyncLabel(stamp: SplitwiseSyncStamp): string {
  const group = stamp.groupName ? ` · ${stamp.groupName}` : ''
  const failedAt = stamp.lastAttemptAt ? formatLocalDateTime(stamp.lastAttemptAt, stamp.timeZone) : null
  const failed = failedAt
    ? `The latest attempt failed at ${failedAt}, so this copy may be out of date.`
    : 'The latest attempt failed, so this copy may be out of date.'
  const neverFailed = failedAt ? `Not synced yet. The last attempt failed at ${failedAt}.` : 'Not synced yet. The last attempt failed.'

  if (!stamp.syncedAt) return stamp.lastAttemptFailed ? neverFailed : 'Not synced yet.'
  const when = formatLocalDateTime(stamp.syncedAt, stamp.timeZone)
  if (!when) return stamp.lastAttemptFailed ? neverFailed : 'Not synced yet.'
  if (stamp.lastAttemptFailed) return `Last synced ${when}${group}. ${failed}`
  return `Last synced ${when}${group}`
}

export function splitwiseSyncSourceLabel(source: SplitwiseSyncSource | null): string | null {
  if (source === 'scheduled') return 'Scheduled sync.'
  if (source === 'manual') return 'Manual refresh.'
  if (source === 'service') return 'Refresh after a member was added.'
  return null
}

export function missingNewSyncColumns(message: string): boolean {
  const lower = message.toLowerCase()
  const names = lower.includes('sync_source') || lower.includes('last_attempt_at') || lower.includes('last_attempt_failed')
  const shape = lower.includes('column') || lower.includes('schema cache') || lower.includes('could not find')
  return names && shape
}
