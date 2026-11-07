export const STREAM_ACTIONS = ['create', 'add_scorecard', 'end'] as const

export type StreamAction = (typeof STREAM_ACTIONS)[number]

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type StreamJobRequest = {
  scheduleEventId: string
  action: StreamAction
  payload: Record<string, string>
}

export function parseStreamScorecardUrl(value: string): string | null | 'invalid' {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (trimmed.length > 500) return 'invalid'
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return 'invalid'
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'invalid'
  if (url.username || url.password) return 'invalid'
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  const cricclubs = host === 'cricclubs.com' || host.endsWith('.cricclubs.com')
  if (!cricclubs) return 'invalid'
  url.protocol = 'https:'
  url.hash = ''
  return url.toString()
}

export function readStreamJobRequest(body: unknown): StreamJobRequest | string {
  if (!body || typeof body !== 'object') return 'Send JSON.'
  const record = body as Record<string, unknown>
  const scheduleEventId = record.scheduleEventId
  const action = record.action
  if (typeof scheduleEventId !== 'string' || !UUID_PATTERN.test(scheduleEventId)) {
    return 'Choose a game, then try again.'
  }
  if (action !== 'create' && action !== 'add_scorecard' && action !== 'end') {
    return 'Choose a stream action.'
  }
  if (
    typeof record.streamKey === 'string' ||
    typeof record.key === 'string' ||
    typeof record.secret === 'string' ||
    typeof record.streamKeyValue === 'string'
  ) {
    return 'Stream key values are not stored.'
  }
  const id = scheduleEventId.toLowerCase()
  if (action === 'create') {
    if (typeof record.streamKeyName !== 'string') return 'Choose a stream key.'
    const name = record.streamKeyName.trim()
    if (name.length < 1 || name.length > 80) return 'Choose a stream key.'
    return { scheduleEventId: id, action, payload: { stream_key_name: name } }
  }
  if (action === 'add_scorecard') {
    if (typeof record.scorecardUrl !== 'string') return 'Enter a cricclubs.com scorecard link.'
    const parsed = parseStreamScorecardUrl(record.scorecardUrl)
    if (parsed === null || parsed === 'invalid') return 'Enter a cricclubs.com scorecard link.'
    return { scheduleEventId: id, action, payload: { scorecard_url: parsed } }
  }
  return { scheduleEventId: id, action, payload: {} }
}

export type WebhookCall = {
  url: string
  headers: Record<string, string>
  body: string
}

/** Null when the URL or key secret is missing. The job stays pending for the processor. */
export function webhookCall(url: string | undefined, key: string | undefined, jobId: string): WebhookCall | null {
  const endpoint = url?.trim() ?? ''
  const secret = key?.trim() ?? ''
  if (!endpoint || !secret || !jobId) return null
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  return {
    url: parsed.toString(),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${secret}`,
      'X-Webhook-Key': secret,
    },
    body: JSON.stringify({ job_id: jobId }),
  }
}

export function readJobId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const jobId = (data as { job_id?: unknown }).job_id
  if (typeof jobId !== 'string' || !UUID_PATTERN.test(jobId)) return null
  return jobId.toLowerCase()
}
