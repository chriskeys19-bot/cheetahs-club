import { json, redactForLog } from '../_shared/http.ts'
import { oauthSecrets, requireStaff, serviceClient } from '../_shared/club_user.ts'
import { readOauthToken } from '../_shared/youtube_oauth.ts'
import {
  RECENT_ENDED_MS,
  RECONNECT_MESSAGE,
  executeEnd,
  executeStart,
  listChannelBroadcasts,
  publicConnection,
  syncPlan,
  testChannelConnection,
  toClientBroadcast,
  watchUrl,
  parseStreamLabels,
  streamStatusUrl,
  VIDEO_ID,
  type ParsedBroadcast,
  type PublicConnection,
  type YoutubeCaller,
} from '../_shared/youtube_broadcasts.ts'

// Lists, tests, starts, and ends broadcasts for a signed-in captain or admin.
// verify_jwt stays on. The handler calls getUser and checks profiles.role.
// The refresh token stays in private.youtube_connections.

type StoredConnection = {
  refreshToken: string
  channelId: string | null
  channelTitle: string | null
  connectedAt: string | null
  tokenError: string | null
}

function parseStored(value: unknown): StoredConnection | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  if (row.connected !== true) return null
  const refreshToken = row.refresh_token
  if (typeof refreshToken !== 'string' || refreshToken.length < 20) return null
  return {
    refreshToken,
    channelId: typeof row.channel_id === 'string' ? row.channel_id : null,
    channelTitle: typeof row.channel_title === 'string' ? row.channel_title : null,
    connectedAt: typeof row.connected_at === 'string' ? row.connected_at : null,
    tokenError: typeof row.token_error === 'string' ? row.token_error : null,
  }
}

function shownConnection(stored: StoredConnection | null, tokenError: string | null = null): PublicConnection {
  if (!stored) return publicConnection(null)
  return publicConnection({
    channelId: stored.channelId,
    channelTitle: stored.channelTitle,
    connectedAt: stored.connectedAt,
    tokenError: tokenError ?? stored.tokenError,
  })
}

const NOT_CONNECTED = 'YouTube is not connected yet. An admin needs to connect the CricketCrazeUSA account.'

async function refreshAccessToken(refreshToken: string, clientId: string, clientSecret: string): Promise<
  | { ok: true; accessToken: string; refreshToken: string | null }
  | { ok: false; reason: 'invalid_grant' | 'exchange' }
> {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  })
  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const parsed = readOauthToken(await response.json())
    if (!parsed.ok) return parsed
    return { ok: true, accessToken: parsed.accessToken, refreshToken: parsed.refreshToken }
  } catch (error) {
    console.error('youtube refresh failed', redactForLog(error instanceof Error ? error.message : 'fetch failed'))
    return { ok: false, reason: 'exchange' }
  }
}

function youtubeCaller(token: string): YoutubeCaller {
  return async (input) => {
    const response = await fetch(input.url, {
      method: input.method,
      headers: { Authorization: `Bearer ${token}` },
    })
    let body: unknown = null
    try {
      body = await response.json()
    } catch {
      body = null
    }
    return { status: response.status, json: body }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: json(req, 204, {}).headers })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const staff = await requireStaff(req)
  if ('error' in staff) return json(req, staff.status, { error: staff.error })

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'That request is too large.' })
  let body: unknown = {}
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown
    } catch {
      return json(req, 400, { error: 'Send JSON.' })
    }
  }
  const action = body && typeof body === 'object' ? (body as { action?: unknown }).action : null
  const broadcastId = body && typeof body === 'object' ? (body as { broadcastId?: unknown }).broadcastId : null
  if (action !== 'status' && action !== 'list' && action !== 'test' && action !== 'start' && action !== 'end') {
    return json(req, 400, { error: 'Choose a broadcast action.' })
  }
  if ((action === 'start' || action === 'end') && (typeof broadcastId !== 'string' || !VIDEO_ID.test(broadcastId))) {
    return json(req, 400, { error: 'Choose a broadcast.' })
  }

  const admin = serviceClient()
  if (!admin) return json(req, 500, { error: 'Streams are not available right now.' })
  const storedResult = await admin.rpc('youtube_connection_read')
  if (storedResult.error) return json(req, 500, { error: 'Streams are not available right now.' })
  const stored = parseStored(storedResult.data)
  const connection = shownConnection(stored)

  if (action === 'status') return json(req, 200, { connection })
  if (!stored) return json(req, 409, { error: NOT_CONNECTED, connection })

  const secrets = oauthSecrets()
  if (!secrets) return json(req, 500, { error: 'YouTube OAuth is not configured yet.', connection })

  const refreshed = await refreshAccessToken(stored.refreshToken, secrets.clientId, secrets.clientSecret)
  if (!refreshed.ok) {
    if (refreshed.reason === 'invalid_grant') {
      await admin.rpc('youtube_connection_mark_error', { p_message: 'Refresh token expired or revoked.' })
      return json(req, 409, { error: RECONNECT_MESSAGE, connection: shownConnection(stored, 'expired') })
    }
    return json(req, 502, { error: 'YouTube did not respond. Try again.', connection })
  }
  await admin.rpc('youtube_connection_note_refresh', { p_refresh_token: refreshed.refreshToken })
  const liveConnection = shownConnection({ ...stored, tokenError: null })
  const call = youtubeCaller(refreshed.accessToken)

  if (action === 'test') {
    const tested = await testChannelConnection(call, refreshed.accessToken)
    if (!tested.ok) {
      if (tested.reconnect) {
        await admin.rpc('youtube_connection_mark_error', { p_message: 'YouTube rejected the access token.' })
        return json(req, 409, { error: tested.message, connection: shownConnection(stored, 'expired') })
      }
      return json(req, 502, { error: tested.message, connection: liveConnection })
    }
    return json(req, 200, {
      ok: true,
      count: tested.count,
      message: `YouTube responded. The test read ${tested.count} broadcast${tested.count === 1 ? '' : 's'} and did not change any.`,
      connection: liveConnection,
    })
  }

  if (action === 'list') {
    const listed = await listChannelBroadcasts(call, refreshed.accessToken)
    if (!listed.ok) {
      if (listed.reconnect) {
        await admin.rpc('youtube_connection_mark_error', { p_message: 'YouTube rejected the access token.' })
        return json(req, 409, { error: listed.message, connection: shownConnection(stored, 'expired') })
      }
      return json(req, 502, { error: listed.message, connection: liveConnection })
    }
    const now = Date.now()
    const fresh = listed.rows.filter((row) => {
      if (row.lifeCycle !== 'complete' && row.lifeCycle !== 'revoked') return true
      const stamp = Date.parse(row.actualEnd ?? row.scheduledStart ?? '')
      return Number.isFinite(stamp) && now - stamp <= RECENT_ENDED_MS
    })
    const broadcasts = await withStreamKeys(admin, call, refreshed.accessToken, fresh)
    return json(req, 200, { connection: liveConnection, broadcasts })
  }

  const id = broadcastId as string
  const result = action === 'start'
    ? await executeStart(id, call, refreshed.accessToken)
    : await executeEnd(id, call, refreshed.accessToken)
  if (!result.ok) {
    if (result.reconnect) {
      await admin.rpc('youtube_connection_mark_error', { p_message: 'YouTube rejected the access token.' })
      return json(req, 409, { error: result.message, connection: shownConnection(stored, 'expired') })
    }
    return json(req, 409, { error: result.message, connection: liveConnection })
  }

  const matched = result.lifeCycle === 'live' || result.lifeCycle === 'complete'
    ? await syncMatched(admin, id, result.phase, staff.caller.id)
    : 0
  return json(req, 200, {
    ok: true,
    message: result.message,
    lifeCycle: result.lifeCycle,
    matched,
    connection: liveConnection,
  })
})

async function withStreamKeys(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  call: YoutubeCaller,
  token: string,
  rows: ParsedBroadcast[],
) {
  const ids = rows.map((row) => row.id)
  const keys = new Map<string, string>()
  if (ids.length > 0) {
    const matched = await admin
      .from('game_streams')
      .select('youtube_video_id, stream_key_name, status')
      .in('youtube_video_id', ids)
    if (!matched.error && Array.isArray(matched.data)) {
      for (const item of matched.data) {
        if (!item || typeof item !== 'object') continue
        const record = item as { youtube_video_id?: unknown; stream_key_name?: unknown; status?: unknown }
        const videoId = typeof record.youtube_video_id === 'string' ? record.youtube_video_id : ''
        const name = typeof record.stream_key_name === 'string' ? record.stream_key_name.trim() : ''
        if (!videoId || !name) continue
        const current = keys.get(videoId)
        const ended = record.status === 'ended' || record.status === 'failed'
        if (!current || !ended) keys.set(videoId, name)
      }
    }
  }

  const boundIds = [...new Set(rows.map((row) => row.boundStreamId).filter((id): id is string => Boolean(id)))]
  const labels = new Map<string, string | null>()
  for (let index = 0; index < boundIds.length; index += 50) {
    const slice = boundIds.slice(index, index + 50)
    const response = await call({ url: streamStatusUrl(slice), method: 'GET', token })
    if (response.status >= 400) continue
    for (const [id, label] of parseStreamLabels(response.json)) labels.set(id, label.title)
  }

  const broadcasts = []
  for (const row of rows) {
    const client = toClientBroadcast(row, keys.get(row.id) ?? null, row.boundStreamId ? labels.get(row.boundStreamId) ?? null : null)
    if (client) broadcasts.push(client)
  }
  return broadcasts
}

async function syncMatched(
  admin: NonNullable<ReturnType<typeof serviceClient>>,
  videoId: string,
  phase: 'live' | 'complete',
  actorId: string,
): Promise<number> {
  const url = watchUrl(videoId)
  const found = await admin.from('game_streams').select('id, status').eq('youtube_video_id', videoId)
  if (found.error || !Array.isArray(found.data) || found.data.length === 0) return 0
  const streamIds = found.data
    .map((item) => (item && typeof item === 'object' ? (item as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === 'string')
  const jobs = streamIds.length
    ? await admin
        .from('stream_jobs')
        .select('game_stream_id, action, status')
        .in('game_stream_id', streamIds)
        .in('status', ['pending', 'running'])
    : { data: [], error: null }
  const openByStream = new Map<string, { action: string; status: string }>()
  if (!jobs.error && Array.isArray(jobs.data)) {
    for (const job of jobs.data) {
      if (!job || typeof job !== 'object') continue
      const record = job as { game_stream_id?: unknown; action?: unknown; status?: unknown }
      if (typeof record.game_stream_id !== 'string' || typeof record.action !== 'string' || typeof record.status !== 'string') {
        continue
      }
      if (!openByStream.has(record.game_stream_id)) {
        openByStream.set(record.game_stream_id, { action: record.action, status: record.status })
      }
    }
  }

  let matched = 0
  for (const item of found.data) {
    if (!item || typeof item !== 'object') continue
    const record = item as { id?: unknown; status?: unknown }
    if (typeof record.id !== 'string' || typeof record.status !== 'string') continue
    const plan = syncPlan({
      phase,
      status: record.status,
      openJob: openByStream.get(record.id) ?? null,
    })
    if (!plan.nextStatus && !plan.confirmEnd) {
      matched += 1
      continue
    }
    const applied = await admin.rpc('youtube_broadcast_apply', {
      p_game_stream_id: record.id,
      p_next_status: plan.nextStatus,
      p_confirm_end: plan.confirmEnd,
      p_actor: actorId,
      p_watch_url: url,
    })
    if (!applied.error) matched += 1
  }
  return matched
}
