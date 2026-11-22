import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALREADY_ENDED,
  ENCODER_NOT_READY,
  NOT_LIVE_YET,
  RECONNECT_MESSAGE,
  executeEnd,
  executeStart,
  parseBroadcastItem,
  parseStreamLabels,
  planEnd,
  planStart,
  publicConnection,
  readGoogleFailure,
  syncPlan,
  toClientBroadcast,
  watchUrl,
  type ParsedBroadcast,
  type YoutubeCaller,
} from './youtube_broadcasts.ts'

const ID = 'abcdefghijk'
const STREAM = 'streamKeyId123'

function broadcast(lifeCycle: string, bound = STREAM): ParsedBroadcast {
  return {
    id: ID,
    title: 'Pulse Play vs Hawks',
    scheduledStart: '2026-11-26T18:00:00.000Z',
    actualStart: null,
    actualEnd: null,
    lifeCycle,
    boundStreamId: bound,
  }
}

function apiBroadcast(lifeCycle: string) {
  return {
    id: ID,
    snippet: { title: 'Pulse Play vs Hawks', scheduledStartTime: '2026-11-26T18:00:00Z' },
    status: { lifeCycleStatus: lifeCycle },
    contentDetails: { boundStreamId: STREAM },
  }
}

function caller(routes: (url: string, method: string) => { status: number; json: unknown }): YoutubeCaller {
  return (input) => Promise.resolve(routes(input.url, input.method))
}

test('start goes testing then live only when YouTube is receiving video', () => {
  assert.equal(planStart({ lifeCycle: 'ready', ingest: 'inactive', bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'ready', ingest: null, bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'ready', ingest: 'active', bound: false }).kind, 'error')
  const ready = planStart({ lifeCycle: 'ready', ingest: 'active', bound: true })
  assert.deepEqual(ready, { kind: 'transition', steps: ['testing', 'live'] })
  assert.deepEqual(planStart({ lifeCycle: 'testing', ingest: 'active', bound: true }), {
    kind: 'transition',
    steps: ['live'],
  })
  assert.equal(planStart({ lifeCycle: 'testStarting', ingest: 'active', bound: true }).kind, 'wait')
  assert.equal(planStart({ lifeCycle: 'live', ingest: 'active', bound: true }).kind, 'done')
  assert.equal(planStart({ lifeCycle: 'complete', ingest: 'active', bound: true }).kind, 'error')
  assert.equal(planStart({ lifeCycle: 'created', ingest: 'active', bound: true }).kind, 'error')
})

test('end completes a live broadcast and refuses one that never started', () => {
  assert.equal(planEnd('live').kind, 'transition')
  assert.equal(planEnd('testing').kind, 'transition')
  assert.equal(planEnd('complete').kind, 'done')
  const upcoming = planEnd('ready')
  assert.equal(upcoming.kind, 'error')
  if (upcoming.kind === 'error') assert.equal(upcoming.message, NOT_LIVE_YET)
})

test('inactive stream and revoked token become readable errors', () => {
  const inactive = readGoogleFailure(403, {
    error: { code: 403, message: 'Stream is inactive', errors: [{ reason: 'errorStreamInactive', message: 'inactive' }] },
  })
  assert.equal(inactive?.message, ENCODER_NOT_READY)
  assert.equal(inactive?.reason, 'errorStreamInactive')
  const revoked = readGoogleFailure(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' })
  assert.equal(revoked?.message, RECONNECT_MESSAGE)
  assert.equal(revoked ? true : false, true)
  const transition = readGoogleFailure(403, { error: { errors: [{ reason: 'invalidTransition' }] } })
  assert.match(transition?.message ?? '', /would not change/i)
})

test('executeStart transitions ready to testing and then live', async () => {
  const calls: string[] = []
  const result = await executeStart(
    ID,
    caller((url, method) => {
      calls.push(`${method} ${url.includes('/transition') ? url.split('broadcastStatus=')[1] : 'read'}`)
      if (url.includes('/liveStreams')) return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'active' } }] } }
      if (url.includes('broadcastStatus=testing')) return { status: 200, json: apiBroadcast('testing') }
      if (url.includes('broadcastStatus=live')) return { status: 200, json: apiBroadcast('live') }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(result.ok, true)
  if (result.ok) {
    assert.equal(result.phase, 'live')
    assert.equal(result.lifeCycle, 'live')
  }
  assert.ok(calls.some((call) => call.startsWith('POST testing')))
  assert.ok(calls.some((call) => call.startsWith('POST live')))
})

test('executeStart stops when the encoder is not sending video', async () => {
  const calls: string[] = []
  const result = await executeStart(
    ID,
    caller((url, method) => {
      calls.push(method)
      if (url.includes('/liveStreams')) {
        return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'inactive' } }] } }
      }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.deepEqual(result, { ok: false, message: ENCODER_NOT_READY, reconnect: false })
  assert.equal(calls.includes('POST'), false)
})

test('executeStart tries live when testing is not allowed', async () => {
  const result = await executeStart(
    ID,
    caller((url) => {
      if (url.includes('/liveStreams')) return { status: 200, json: { items: [{ id: STREAM, status: { streamStatus: 'active' } }] } }
      if (url.includes('broadcastStatus=testing')) {
        return { status: 403, json: { error: { errors: [{ reason: 'invalidTransition' }] } } }
      }
      if (url.includes('broadcastStatus=live')) return { status: 200, json: apiBroadcast('live') }
      return { status: 200, json: { items: [apiBroadcast('ready')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.lifeCycle, 'live')
})

test('executeEnd confirms complete and does not claim success early', async () => {
  const ended = await executeEnd(
    ID,
    caller((url) => {
      if (url.includes('broadcastStatus=complete')) return { status: 200, json: apiBroadcast('complete') }
      return { status: 200, json: { items: [apiBroadcast('live')] } }
    }),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(ended.ok, true)
  if (ended.ok) assert.equal(ended.phase, 'complete')

  const early = await executeEnd(
    ID,
    caller(() => ({ status: 200, json: { items: [apiBroadcast('ready')] } })),
    'ya29.access-token-value',
    { timeoutMs: 0, sleep: () => Promise.resolve() },
  )
  assert.equal(early.ok, false)
  if (!early.ok) assert.equal(early.message, NOT_LIVE_YET)
})

test('a matched stream is marked ended only after YouTube complete', () => {
  assert.deepEqual(syncPlan({ phase: 'complete', status: 'ready', openJob: null }), {
    nextStatus: 'ended',
    confirmEnd: true,
  })
  assert.deepEqual(syncPlan({ phase: 'complete', status: 'ended', openJob: { action: 'end', status: 'pending' } }), {
    nextStatus: 'ended',
    confirmEnd: true,
  })
  assert.deepEqual(syncPlan({ phase: 'live', status: 'ended', openJob: null }), {
    nextStatus: 'ready',
    confirmEnd: false,
  })
  assert.deepEqual(syncPlan({ phase: 'live', status: 'awaiting_scorecard', openJob: null }), {
    nextStatus: null,
    confirmEnd: false,
  })
  assert.deepEqual(
    syncPlan({ phase: 'live', status: 'ready', openJob: { action: 'add_scorecard', status: 'running' } }),
    { nextStatus: null, confirmEnd: false },
  )
})

test('client broadcasts expose the watch URL and never a stream secret', () => {
  assert.equal(watchUrl(ID), 'https://www.youtube.com/watch?v=abcdefghijk')
  assert.equal(watchUrl('bad id'), null)
  const row = toClientBroadcast(broadcast('ready'), null, 'abcdabcdabcdabcdabcd')
  assert.equal(row?.streamKeyName, null)
  assert.equal(row?.watchUrl, 'https://www.youtube.com/watch?v=abcdefghijk')
  const named = toClientBroadcast(broadcast('ready'), 'PSD Key 1', 'Default stream key')
  assert.equal(named?.streamKeyName, 'PSD Key 1')
  const parsed = parseBroadcastItem({
    id: ID,
    snippet: { title: 'Pulse Play', scheduledStartTime: '2026-11-26T18:00:00Z' },
    status: { lifeCycleStatus: 'ready' },
    contentDetails: { boundStreamId: STREAM },
    cdn: { ingestionInfo: { streamName: 'super-secret-key' } },
  })
  assert.equal(JSON.stringify(parsed).includes('super-secret-key'), false)
  const labels = parseStreamLabels({
    items: [{ id: STREAM, snippet: { title: 'Yolobox Pro 1' }, status: { streamStatus: 'active' }, cdn: { ingestionInfo: { streamName: 'secret' } } }],
  })
  assert.equal(labels.get(STREAM)?.title, 'Yolobox Pro 1')
  assert.equal(JSON.stringify([...labels.values()]).includes('secret'), false)
})

test('connection status for the browser omits the refresh token', () => {
  const shown = publicConnection({
    channelId: 'UCcheetahs',
    channelTitle: 'CricketCrazeUSA',
    connectedAt: '2026-11-22T12:00:00.000Z',
    tokenError: 'expired',
    refreshToken: '1//do-not-send',
  })
  assert.equal(shown.needsReconnect, true)
  assert.equal(shown.message, RECONNECT_MESSAGE)
  assert.equal(JSON.stringify(shown).includes('1//'), false)
  assert.equal(JSON.stringify(shown).includes('refreshToken'), false)
  const ended = planEnd('complete')
  if (ended.kind === 'done') assert.match(ended.message, /already ended/)
  assert.equal(ALREADY_ENDED.length > 0, true)
})
