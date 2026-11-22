export const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3'
export const VIDEO_ID = /^[A-Za-z0-9_-]{6,64}$/
export const RECENT_ENDED_MS = 14 * 24 * 60 * 60 * 1000

export const ENCODER_NOT_READY =
  'YouTube is not receiving video for this broadcast yet. Start the encoder (OBS or Pulse Play) on this stream key, wait until YouTube shows the stream as active, then press Start again.'

export const NOT_BOUND = 'This broadcast is not attached to a YouTube stream yet, so it cannot go live.'

export const ALREADY_ENDED = 'This broadcast has already ended on YouTube.'

export const NOT_LIVE_YET =
  'This broadcast is not live yet, so it cannot be ended. Press Start once the encoder is sending video.'

export const STILL_CREATED =
  'This broadcast is still being created on YouTube. Wait until it is ready, then press Start again.'

export const RECONNECT_MESSAGE =
  'The YouTube connection expired or was revoked. An admin needs to reconnect. Google test-mode refresh tokens expire after 7 days unless the consent screen is published to Production.'

export const SETUP_STATUSES = [
  'checking',
  'creating',
  'awaiting_scorecard',
  'setting_up_overlay',
  'updating_stream',
] as const

export function watchUrl(id: string): string | null {
  if (!VIDEO_ID.test(id)) return null
  return `https://www.youtube.com/watch?v=${id}`
}

export type ParsedBroadcast = {
  id: string
  title: string
  scheduledStart: string | null
  actualStart: string | null
  actualEnd: string | null
  lifeCycle: string
  boundStreamId: string | null
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > max) return null
  return trimmed
}

function iso(value: unknown): string | null {
  const raw = text(value, 40)
  if (!raw || !Number.isFinite(Date.parse(raw))) return null
  return new Date(raw).toISOString()
}

export function parseBroadcastItem(value: unknown): ParsedBroadcast | null {
  if (!value || typeof value !== 'object') return null
  const item = value as { id?: unknown; snippet?: unknown; status?: unknown; contentDetails?: unknown }
  const id = text(item.id, 64)
  if (!id || !VIDEO_ID.test(id)) return null
  const snippet = item.snippet && typeof item.snippet === 'object' ? (item.snippet as Record<string, unknown>) : {}
  const status = item.status && typeof item.status === 'object' ? (item.status as Record<string, unknown>) : {}
  const details =
    item.contentDetails && typeof item.contentDetails === 'object'
      ? (item.contentDetails as Record<string, unknown>)
      : {}
  const lifeCycle = text(status.lifeCycleStatus, 40)
  if (!lifeCycle) return null
  const bound = text(details.boundStreamId, 64)
  return {
    id,
    title: text(snippet.title, 200) ?? 'Untitled broadcast',
    scheduledStart: iso(snippet.scheduledStartTime),
    actualStart: iso(snippet.actualStartTime),
    actualEnd: iso(snippet.actualEndTime),
    lifeCycle,
    boundStreamId: bound && /^[A-Za-z0-9_-]{1,64}$/.test(bound) ? bound : null,
  }
}

export function parseBroadcastPage(body: unknown): { items: ParsedBroadcast[]; nextPageToken: string | null } {
  if (!body || typeof body !== 'object') return { items: [], nextPageToken: null }
  const record = body as { items?: unknown; nextPageToken?: unknown }
  const items: ParsedBroadcast[] = []
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      const parsed = parseBroadcastItem(item)
      if (parsed) items.push(parsed)
    }
  }
  const token = text(record.nextPageToken, 200)
  return { items, nextPageToken: token }
}

export type StreamLabel = { title: string | null; ingest: string | null }

export function parseStreamLabels(body: unknown): Map<string, StreamLabel> {
  const labels = new Map<string, StreamLabel>()
  if (!body || typeof body !== 'object') return labels
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items)) return labels
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const row = item as { id?: unknown; snippet?: unknown; status?: unknown }
    const id = text(row.id, 64)
    if (!id) continue
    const snippet = row.snippet && typeof row.snippet === 'object' ? (row.snippet as { title?: unknown }) : {}
    const status = row.status && typeof row.status === 'object' ? (row.status as { streamStatus?: unknown }) : {}
    labels.set(id, {
      title: text(snippet.title, 80),
      ingest: text(status.streamStatus, 40),
    })
  }
  return labels
}

export type StartPlan =
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'transition'; steps: Array<'testing' | 'live'> }
  | { kind: 'wait'; until: 'testing' | 'live'; thenLive: boolean }

export function planStart(input: { lifeCycle: string; ingest: string | null; bound: boolean }): StartPlan {
  const life = input.lifeCycle
  if (life === 'live') return { kind: 'done', message: 'This broadcast is already live on YouTube.' }
  if (life === 'complete') return { kind: 'error', message: ALREADY_ENDED }
  if (life === 'revoked') return { kind: 'error', message: 'YouTube revoked this broadcast.' }
  if (life === 'liveStarting') return { kind: 'wait', until: 'live', thenLive: false }
  if (!input.bound) return { kind: 'error', message: NOT_BOUND }
  if (input.ingest !== 'active') return { kind: 'error', message: ENCODER_NOT_READY }
  if (life === 'created') return { kind: 'error', message: STILL_CREATED }
  if (life === 'ready') return { kind: 'transition', steps: ['testing', 'live'] }
  if (life === 'testStarting') return { kind: 'wait', until: 'testing', thenLive: true }
  if (life === 'testing') return { kind: 'transition', steps: ['live'] }
  return {
    kind: 'error',
    message: 'YouTube would not start this broadcast from its current state. Refresh the list and try again.',
  }
}

export type EndPlan =
  | { kind: 'done'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'transition' }
  | { kind: 'wait' }

export function planEnd(lifeCycle: string): EndPlan {
  if (lifeCycle === 'complete') return { kind: 'done', message: 'This broadcast is already ended on YouTube.' }
  if (lifeCycle === 'revoked') return { kind: 'error', message: 'YouTube revoked this broadcast.' }
  if (lifeCycle === 'live' || lifeCycle === 'testing' || lifeCycle === 'testStarting') return { kind: 'transition' }
  if (lifeCycle === 'liveStarting') return { kind: 'wait' }
  if (lifeCycle === 'created' || lifeCycle === 'ready') return { kind: 'error', message: NOT_LIVE_YET }
  return {
    kind: 'error',
    message: 'YouTube would not end this broadcast from its current state. Refresh the list and try again.',
  }
}

export type GoogleFailure = { status: number; reason: string; message: string }

export function humanYouTubeFailure(reason: string, status: number): string {
  const key = reason.toLowerCase()
  if (key === 'errorstreaminactive' || key === 'streaminactive') return ENCODER_NOT_READY
  if (key === 'invalidtransition') {
    return 'YouTube would not change this broadcast yet. Refresh the list. If the preview is still coming up, wait until YouTube is receiving video and press Start again.'
  }
  if (key === 'livebroadcastnotfound' || key === 'notfound' || status === 404) {
    return 'That broadcast is not on the connected YouTube channel.'
  }
  if (key === 'invalid_grant' || key === 'autherror' || key === 'unauthorized' || status === 401) {
    return RECONNECT_MESSAGE
  }
  if (key === 'insufficientpermissions' || key === 'forbidden') return RECONNECT_MESSAGE
  if (key === 'quotaexceeded' || key === 'ratelimitexceeded') {
    return 'YouTube quota is used up for now. Wait a few minutes, then try again.'
  }
  return 'YouTube could not update this broadcast. Refresh the list and try again.'
}

export function readGoogleFailure(status: number, body: unknown): GoogleFailure | null {
  if (status < 400) return null
  let reason = 'unknown'
  if (body && typeof body === 'object') {
    const error = (body as { error?: unknown }).error
    if (typeof error === 'string' && error.trim()) reason = error.trim()
    if (error && typeof error === 'object') {
      const errors = (error as { errors?: unknown }).errors
      if (Array.isArray(errors) && errors[0] && typeof errors[0] === 'object') {
        const named = (errors[0] as { reason?: unknown }).reason
        if (typeof named === 'string' && named.trim()) reason = named.trim()
      }
    }
  }
  return { status, reason, message: humanYouTubeFailure(reason, status) }
}

export function needsReconnect(failure: GoogleFailure): boolean {
  const key = failure.reason.toLowerCase()
  return key === 'invalid_grant' || key === 'autherror' || key === 'unauthorized' || failure.status === 401
}

export type SyncPlan = {
  nextStatus: 'ready' | 'ended' | null
  confirmEnd: boolean
}

/**
 * Live: move a matched row to ready unless the bot still owns a setup step or an open job.
 * Complete: set ended and record a done end job. Ended is never stored before YouTube confirms.
 */
export function syncPlan(input: {
  phase: 'live' | 'complete'
  status: string
  openJob: { action: string; status: string } | null
}): SyncPlan {
  if (input.phase === 'complete') return { nextStatus: 'ended', confirmEnd: true }
  const open = input.openJob
  if (open && (open.status === 'pending' || open.status === 'running')) {
    return { nextStatus: null, confirmEnd: false }
  }
  if (SETUP_STATUSES.includes(input.status as (typeof SETUP_STATUSES)[number])) {
    return { nextStatus: null, confirmEnd: false }
  }
  if (input.status === 'ready') return { nextStatus: null, confirmEnd: false }
  return { nextStatus: 'ready', confirmEnd: false }
}

export function looksLikeStreamSecret(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length > 80) return true
  return /^[A-Za-z0-9_-]{20,}$/.test(trimmed)
}

export type ClientBroadcast = {
  id: string
  title: string
  scheduledStart: string | null
  actualStart: string | null
  actualEnd: string | null
  lifeCycle: string
  streamKeyName: string | null
  watchUrl: string
}

export function toClientBroadcast(
  row: ParsedBroadcast,
  streamKeyName: string | null,
  youtubeStreamTitle: string | null,
): ClientBroadcast | null {
  const url = watchUrl(row.id)
  if (!url) return null
  const club = streamKeyName?.trim() ?? ''
  const youtube = youtubeStreamTitle?.trim() ?? ''
  const name = club || (youtube && !looksLikeStreamSecret(youtube) ? youtube : '')
  return {
    id: row.id,
    title: row.title,
    scheduledStart: row.scheduledStart,
    actualStart: row.actualStart,
    actualEnd: row.actualEnd,
    lifeCycle: row.lifeCycle,
    streamKeyName: name || null,
    watchUrl: url,
  }
}

export type PublicConnection = {
  connected: boolean
  needsReconnect: boolean
  channelId: string | null
  channelTitle: string | null
  connectedAt: string | null
  message: string | null
}

export function publicConnection(row: {
  channelId?: string | null
  channelTitle?: string | null
  connectedAt?: string | null
  tokenError?: string | null
  refreshToken?: string | null
} | null): PublicConnection {
  if (!row) {
    return {
      connected: false,
      needsReconnect: false,
      channelId: null,
      channelTitle: null,
      connectedAt: null,
      message: null,
    }
  }
  const needsReconnect = Boolean(row.tokenError)
  return {
    connected: true,
    needsReconnect,
    channelId: row.channelId ?? null,
    channelTitle: row.channelTitle ?? null,
    connectedAt: row.connectedAt ?? null,
    message: needsReconnect ? RECONNECT_MESSAGE : null,
  }
}

export type YoutubeResponse = { status: number; json: unknown }

export type YoutubeCaller = (input: { url: string; method: 'GET' | 'POST'; token: string }) => Promise<YoutubeResponse>

export function broadcastListUrl(status: 'upcoming' | 'active' | 'completed' | 'all', pageToken?: string): string {
  const url = new URL(`${YOUTUBE_API}/liveBroadcasts`)
  url.searchParams.set('part', 'snippet,status,contentDetails')
  url.searchParams.set('mine', 'true')
  url.searchParams.set('broadcastStatus', status)
  url.searchParams.set('maxResults', status === 'all' ? '5' : '50')
  if (pageToken) url.searchParams.set('pageToken', pageToken)
  return url.toString()
}

export function broadcastByIdUrl(id: string): string {
  const url = new URL(`${YOUTUBE_API}/liveBroadcasts`)
  url.searchParams.set('part', 'snippet,status,contentDetails')
  url.searchParams.set('id', id)
  return url.toString()
}

export function transitionUrl(id: string, broadcastStatus: 'testing' | 'live' | 'complete'): string {
  const url = new URL(`${YOUTUBE_API}/liveBroadcasts/transition`)
  url.searchParams.set('part', 'id,snippet,status,contentDetails')
  url.searchParams.set('id', id)
  url.searchParams.set('broadcastStatus', broadcastStatus)
  return url.toString()
}

export function streamStatusUrl(ids: string[]): string {
  const url = new URL(`${YOUTUBE_API}/liveStreams`)
  url.searchParams.set('part', 'snippet,status')
  url.searchParams.set('id', ids.join(','))
  url.searchParams.set('maxResults', '50')
  return url.toString()
}

export type ActionResult =
  | { ok: true; lifeCycle: string; message: string; phase: 'live' | 'complete' }
  | { ok: false; message: string; reconnect: boolean }

type ActionOptions = {
  sleep?: (ms: number) => Promise<void>
  pollMs?: number
  timeoutMs?: number
}

async function fetchBroadcast(id: string, call: YoutubeCaller, token: string): Promise<ParsedBroadcast | GoogleFailure | null> {
  const response = await call({ url: broadcastByIdUrl(id), method: 'GET', token })
  const failure = readGoogleFailure(response.status, response.json)
  if (failure) return failure
  return parseBroadcastPage(response.json).items[0] ?? null
}

async function fetchIngest(streamId: string, call: YoutubeCaller, token: string): Promise<string | null | GoogleFailure> {
  const response = await call({ url: streamStatusUrl([streamId]), method: 'GET', token })
  const failure = readGoogleFailure(response.status, response.json)
  if (failure) return failure
  return parseStreamLabels(response.json).get(streamId)?.ingest ?? null
}

async function transition(
  id: string,
  broadcastStatus: 'testing' | 'live' | 'complete',
  call: YoutubeCaller,
  token: string,
): Promise<{ ok: true; lifeCycle: string } | GoogleFailure> {
  const response = await call({ url: transitionUrl(id, broadcastStatus), method: 'POST', token })
  const failure = readGoogleFailure(response.status, response.json)
  if (failure) return failure
  const lifeCycle = parseBroadcastItem(response.json)?.lifeCycle
  if (!lifeCycle) return { status: 502, reason: 'unknown', message: humanYouTubeFailure('unknown', 502) }
  return { ok: true, lifeCycle }
}

function isFailure(value: unknown): value is GoogleFailure {
  return Boolean(value && typeof value === 'object' && 'reason' in value && 'message' in value)
}

async function pollLifeCycle(
  id: string,
  call: YoutubeCaller,
  token: string,
  accept: (lifeCycle: string) => boolean,
  options: ActionOptions,
): Promise<string | GoogleFailure | null> {
  const timeout = options.timeoutMs ?? 15_000
  const poll = options.pollMs ?? 2_000
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const started = Date.now()
  const maxPolls = Math.max(1, Math.ceil(timeout / Math.max(poll, 1)) + 1)
  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const broadcast = await fetchBroadcast(id, call, token)
    if (isFailure(broadcast)) return broadcast
    if (broadcast && accept(broadcast.lifeCycle)) return broadcast.lifeCycle
    if (Date.now() - started >= timeout) return null
    await sleep(poll)
  }
  return null
}

export async function executeStart(
  id: string,
  call: YoutubeCaller,
  token: string,
  options: ActionOptions = {},
): Promise<ActionResult> {
  if (!VIDEO_ID.test(id)) return { ok: false, message: 'That broadcast id is not valid.', reconnect: false }
  let current = await fetchBroadcast(id, call, token)
  if (isFailure(current)) return { ok: false, message: current.message, reconnect: needsReconnect(current) }
  if (!current) return { ok: false, message: 'That broadcast is not on the connected YouTube channel.', reconnect: false }

  for (let attempt = 0; attempt < 4; attempt += 1) {
    let ingest: string | null = null
    if (current.boundStreamId) {
      const read = await fetchIngest(current.boundStreamId, call, token)
      if (isFailure(read)) return { ok: false, message: read.message, reconnect: needsReconnect(read) }
      ingest = read
    }
    const plan = planStart({ lifeCycle: current.lifeCycle, ingest, bound: Boolean(current.boundStreamId) })
    if (plan.kind === 'error') return { ok: false, message: plan.message, reconnect: false }
    if (plan.kind === 'done') return { ok: true, lifeCycle: 'live', message: plan.message, phase: 'live' }
    if (plan.kind === 'wait') {
      const settled = await pollLifeCycle(
        id,
        call,
        token,
        (life) => life === plan.until || life === 'live' || life === 'complete',
        options,
      )
      if (isFailure(settled)) return { ok: false, message: settled.message, reconnect: needsReconnect(settled) }
      if (!settled || settled === 'complete') {
        return {
          ok: false,
          message: settled === 'complete' ? ALREADY_ENDED : 'YouTube is still changing this broadcast. Wait a few seconds, then press Start again.',
          reconnect: false,
        }
      }
      if (settled === 'live') {
        return { ok: true, lifeCycle: 'live', message: 'The broadcast is live on YouTube.', phase: 'live' }
      }
      current = { ...current, lifeCycle: settled }
      continue
    }

    let sawTestingFailure = false
    for (const step of plan.steps) {
      const moved = await transition(id, step, call, token)
      if (isFailure(moved)) {
        if (step === 'testing' && moved.reason.toLowerCase() === 'invalidtransition') {
          sawTestingFailure = true
          continue
        }
        return { ok: false, message: moved.message, reconnect: needsReconnect(moved) }
      }
      sawTestingFailure = false
      let lifeCycle = moved.lifeCycle
      if (lifeCycle === 'testStarting' || lifeCycle === 'liveStarting') {
        const target = lifeCycle === 'testStarting' ? 'testing' : 'live'
        const settled = await pollLifeCycle(
          id,
          call,
          token,
          (life) => life === target || life === 'live' || life === 'testing',
          options,
        )
        if (isFailure(settled)) return { ok: false, message: settled.message, reconnect: needsReconnect(settled) }
        if (!settled) {
          return {
            ok: false,
            message: 'YouTube accepted the change and is still starting. Wait a few seconds, then refresh.',
            reconnect: false,
          }
        }
        lifeCycle = settled
      }
      if (lifeCycle === 'live') {
        return { ok: true, lifeCycle: 'live', message: 'The broadcast is live on YouTube.', phase: 'live' }
      }
      current = { ...current, lifeCycle }
    }
    if (sawTestingFailure) {
      const live = await transition(id, 'live', call, token)
      if (isFailure(live)) return { ok: false, message: live.message, reconnect: needsReconnect(live) }
      if (live.lifeCycle === 'live') {
        return { ok: true, lifeCycle: 'live', message: 'The broadcast is live on YouTube.', phase: 'live' }
      }
    }
    const again = await fetchBroadcast(id, call, token)
    if (isFailure(again)) return { ok: false, message: again.message, reconnect: needsReconnect(again) }
    if (again?.lifeCycle === 'live') {
      return { ok: true, lifeCycle: 'live', message: 'The broadcast is live on YouTube.', phase: 'live' }
    }
    return {
      ok: false,
      message: 'YouTube did not confirm that this broadcast is live. Refresh the list and try Start again.',
      reconnect: false,
    }
  }
  return {
    ok: false,
    message: 'YouTube did not confirm that this broadcast is live. Refresh the list and try Start again.',
    reconnect: false,
  }
}

export async function executeEnd(
  id: string,
  call: YoutubeCaller,
  token: string,
  options: ActionOptions = {},
): Promise<ActionResult> {
  if (!VIDEO_ID.test(id)) return { ok: false, message: 'That broadcast id is not valid.', reconnect: false }
  let current = await fetchBroadcast(id, call, token)
  if (isFailure(current)) return { ok: false, message: current.message, reconnect: needsReconnect(current) }
  if (!current) return { ok: false, message: 'That broadcast is not on the connected YouTube channel.', reconnect: false }

  const plan = planEnd(current.lifeCycle)
  if (plan.kind === 'error') return { ok: false, message: plan.message, reconnect: false }
  if (plan.kind === 'done') return { ok: true, lifeCycle: 'complete', message: plan.message, phase: 'complete' }
  if (plan.kind === 'wait') {
    const settled = await pollLifeCycle(id, call, token, (life) => life === 'live' || life === 'complete', options)
    if (isFailure(settled)) return { ok: false, message: settled.message, reconnect: needsReconnect(settled) }
    if (settled === 'complete') {
      return { ok: true, lifeCycle: 'complete', message: 'This broadcast is already ended on YouTube.', phase: 'complete' }
    }
    if (settled !== 'live') {
      return {
        ok: false,
        message: 'YouTube is still starting this broadcast. Wait a few seconds, then press End again.',
        reconnect: false,
      }
    }
    current = { ...current, lifeCycle: 'live' }
  }

  const moved = await transition(id, 'complete', call, token)
  if (isFailure(moved)) return { ok: false, message: moved.message, reconnect: needsReconnect(moved) }
  let lifeCycle = moved.lifeCycle
  if (lifeCycle !== 'complete') {
    const settled = await pollLifeCycle(id, call, token, (life) => life === 'complete', options)
    if (isFailure(settled)) return { ok: false, message: settled.message, reconnect: needsReconnect(settled) }
    if (settled !== 'complete') {
      return {
        ok: false,
        message: 'YouTube has not confirmed the end yet. Refresh the list before treating this stream as ended.',
        reconnect: false,
      }
    }
    lifeCycle = settled
  }
  return { ok: true, lifeCycle, message: 'The broadcast has ended on YouTube.', phase: 'complete' }
}

export async function listChannelBroadcasts(
  call: YoutubeCaller,
  token: string,
): Promise<{ ok: true; rows: ParsedBroadcast[] } | { ok: false; message: string; reconnect: boolean }> {
  const rows: ParsedBroadcast[] = []
  const seen = new Set<string>()
  for (const status of ['upcoming', 'active', 'completed'] as const) {
    let pageToken: string | undefined
    const pageLimit = status === 'completed' ? 1 : 4
    for (let page = 0; page < pageLimit; page += 1) {
      const response = await call({ url: broadcastListUrl(status, pageToken), method: 'GET', token })
      const failure = readGoogleFailure(response.status, response.json)
      if (failure) return { ok: false, message: failure.message, reconnect: needsReconnect(failure) }
      const parsed = parseBroadcastPage(response.json)
      for (const item of parsed.items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        rows.push(item)
      }
      if (!parsed.nextPageToken) break
      pageToken = parsed.nextPageToken
    }
  }
  return { ok: true, rows }
}

export async function testChannelConnection(
  call: YoutubeCaller,
  token: string,
): Promise<{ ok: true; count: number } | { ok: false; message: string; reconnect: boolean }> {
  const response = await call({ url: broadcastListUrl('all'), method: 'GET', token })
  const failure = readGoogleFailure(response.status, response.json)
  if (failure) return { ok: false, message: failure.message, reconnect: needsReconnect(failure) }
  return { ok: true, count: parseBroadcastPage(response.json).items.length }
}
