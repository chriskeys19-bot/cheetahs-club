const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type SyncRequest = {
  feedbackId: string | null
  backfill: boolean
}

export type SheetRow = {
  id: string
  timestamp: string
  submitter_name: string
  submitter_email: string
  role: string
  suggestion: string
}

export type SheetWriteResult = {
  id: string
  ok: boolean
  error: string | null
}

export function secretsMatch(given: string, expected: string): boolean {
  const encoder = new TextEncoder()
  const left = encoder.encode(given)
  const right = encoder.encode(expected)
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!
  return diff === 0
}

export function scrubSheetError(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 500)
}

export function isAllowedSheetUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  if (url.username || url.password) return false
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return host === 'script.google.com' || host === 'script.googleusercontent.com'
}

export function redirectTarget(from: string, location: string): string | null {
  try {
    const url = new URL(location, from)
    return isAllowedSheetUrl(url.toString()) ? url.toString() : null
  } catch {
    return null
  }
}

export type EchoFetch = {
  url: string
  method: 'GET'
}

// Apps Script answers the POST with 302. The echo URL on
// script.googleusercontent.com accepts only GET. A second POST is HTTP 405.
// The body already went out on the first request. This follow-up has no body
// and no Content-Type.
export function echoFetch(from: string, status: number, location: string | null): EchoFetch | null {
  if (status < 300 || status >= 400) return null
  const header = location?.trim() ?? ''
  if (!header) return null
  const url = redirectTarget(from, header)
  if (!url) return null
  return { url, method: 'GET' }
}

export function readSyncRequest(body: unknown): SyncRequest | string {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return 'Send JSON.'
  const record = body as Record<string, unknown>
  if (record.backfill !== undefined && typeof record.backfill !== 'boolean') return 'backfill must be true or false.'
  if (record.backfill === true) return { feedbackId: null, backfill: true }
  if (typeof record.feedback_id !== 'string' || !UUID_PATTERN.test(record.feedback_id.trim())) {
    return 'Send feedback_id or backfill.'
  }
  return { feedbackId: record.feedback_id.trim().toLowerCase(), backfill: false }
}

function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/[\r\n]+/g, ' ').trim().slice(0, max)
}

export function sheetRowFromFeedback(value: unknown): SheetRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim().toLowerCase() : ''
  if (!UUID_PATTERN.test(id)) return null
  const created = typeof row.created_at === 'string' ? row.created_at : ''
  const timestamp = new Date(created)
  if (Number.isNaN(timestamp.getTime())) return null
  const suggestion = typeof row.body === 'string' ? row.body.replace(/\r\n/g, '\n').trim() : ''
  if (suggestion.length < 1 || suggestion.length > 2000) return null
  const role = row.role === 'admin' || row.role === 'captain' || row.role === 'player' ? row.role : ''
  return {
    id,
    timestamp: timestamp.toISOString(),
    submitter_name: oneLine(row.submitter_name, 200),
    submitter_email: oneLine(row.submitter_email, 320),
    role,
    suggestion,
  }
}

export function sheetRequestBody(secret: string, rows: SheetRow[]): string {
  return JSON.stringify({ secret, rows })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function interpretSheetResponse(status: number, body: unknown, sentIds: string[]): SheetWriteResult[] {
  const failed = (message: string): SheetWriteResult[] => {
    const error = scrubSheetError(message) || 'The sheet did not accept the rows.'
    return sentIds.map((id) => ({ id, ok: false, error }))
  }
  if (status < 200 || status >= 300) {
    const record = asRecord(body)
    const message = typeof record?.error === 'string' ? record.error : `The sheet returned ${status}.`
    return failed(message)
  }
  const record = asRecord(body)
  if (!record || record.ok !== true || !Array.isArray(record.results)) {
    const message = typeof record?.error === 'string' ? record.error : 'The sheet did not accept the rows.'
    return failed(message)
  }
  const byId = new Map<string, { status: string; error: string | null }>()
  for (const item of record.results) {
    const row = asRecord(item)
    const id = typeof row?.id === 'string' ? row.id.trim().toLowerCase() : ''
    if (!UUID_PATTERN.test(id)) continue
    byId.set(id, {
      status: typeof row?.status === 'string' ? row.status : '',
      error: typeof row?.error === 'string' ? row.error : null,
    })
  }
  return sentIds.map((id) => {
    const found = byId.get(id)
    if (!found) return { id, ok: false, error: 'The sheet did not confirm this row.' }
    if (found.status === 'appended' || found.status === 'duplicate') return { id, ok: true, error: null }
    return {
      id,
      ok: false,
      error: scrubSheetError(found.error || 'The sheet rejected this row.') || 'The sheet rejected this row.',
    }
  })
}
