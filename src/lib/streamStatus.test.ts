import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canEditStreamField,
  isPublicStreamStatus,
  liveStreamMessage,
  parseStreamScorecardUrl,
  retryAction,
  shouldAutoEnd,
  streamControlVisible,
  watchUrl,
  type GameStream,
} from './streamStatus.ts'

const stream = (patch: Partial<GameStream>): GameStream => ({
  id: 'stream-1',
  schedule_event_id: 'game-1',
  status: 'none',
  stream_key_name: null,
  youtube_video_id: null,
  youtube_url: null,
  scorecard_url: null,
  overlay_url: null,
  overlay_short_url: null,
  whatsapp_message: null,
  last_error: null,
  requested_by: 'user-1',
  created_at: '2026-11-07T00:00:00Z',
  updated_at: '2026-11-07T00:00:00Z',
  ...patch,
})

test('pending jobs read as Queued', () => {
  const live = liveStreamMessage(stream({ status: 'creating', stream_key_name: 'Yolobox Pro 1' }), {
    status: 'pending',
    action: 'create',
    error: null,
  })
  assert.equal(live.label, 'Queued')
  assert.equal(live.busy, true)
})

test('running jobs use the action copy', () => {
  assert.equal(
    liveStreamMessage(stream({ status: 'creating' }), { status: 'running', action: 'create', error: null }).label,
    'Creating stream…',
  )
  assert.equal(
    liveStreamMessage(stream({ status: 'setting_up_overlay' }), {
      status: 'running',
      action: 'add_scorecard',
      error: null,
    }).label,
    'Adding scorecard and overlay…',
  )
  assert.equal(
    liveStreamMessage(stream({ status: 'ending' }), { status: 'running', action: 'end', error: null }).label,
    'Ending stream…',
  )
})

test('failures keep the processor error and a retry action', () => {
  const row = stream({ status: 'failed', last_error: 'YouTube rejected the broadcast.' })
  const live = liveStreamMessage(row, { status: 'failed', action: 'create', error: 'YouTube rejected the broadcast.' })
  assert.equal(live.label, 'Setup failed: YouTube rejected the broadcast.')
  assert.equal(retryAction(row, { status: 'failed', action: 'create' }), 'create')
})

test('a stream without a scorecard asks for the CricClubs link', () => {
  const live = liveStreamMessage(
    stream({ status: 'awaiting_scorecard', youtube_url: 'https://youtube.com/watch?v=abc', stream_key_name: 'Yolobox Pro 2' }),
    null,
  )
  assert.equal(live.phase, 'scorecard')
  assert.equal(parseStreamScorecardUrl('https://cricclubs.com/Cheetahs/viewScorecard.do?clubId=1'), 'https://cricclubs.com/Cheetahs/viewScorecard.do?clubId=1')
  assert.equal(parseStreamScorecardUrl('https://youtu.be/abc'), 'invalid')
})

test('ended completed games hide the stream control from players', () => {
  assert.equal(
    streamControlVisible({ cheetahsLeague: true, completed: true, status: 'ended', role: 'player' }),
    false,
  )
  assert.equal(
    streamControlVisible({ cheetahsLeague: true, completed: true, status: 'ended', role: 'admin' }),
    true,
  )
  assert.equal(
    streamControlVisible({ cheetahsLeague: true, completed: true, status: 'ready', role: 'player' }),
    true,
  )
  assert.equal(streamControlVisible({ cheetahsLeague: false, completed: false, status: null, role: 'admin' }), false)
})

test('opening a completed stream queues end once', () => {
  const row = stream({ status: 'ready', youtube_url: 'https://youtube.com/watch?v=abc' })
  assert.equal(shouldAutoEnd(true, row, false), true)
  assert.equal(shouldAutoEnd(true, row, true), false)
  assert.equal(shouldAutoEnd(false, row, false), false)
  assert.equal(shouldAutoEnd(true, stream({ status: 'ended', youtube_url: 'https://youtube.com/watch?v=abc' }), false), false)
})

test('public list is upcoming or live only', () => {
  assert.equal(isPublicStreamStatus('ready'), true)
  assert.equal(isPublicStreamStatus('ended'), false)
  assert.equal(isPublicStreamStatus('failed'), false)
  assert.equal(isPublicStreamStatus('none'), false)
})

test('players edit text they requested, not status', () => {
  assert.equal(canEditStreamField('player', 'user-1', 'user-1', 'text'), true)
  assert.equal(canEditStreamField('player', 'user-2', 'user-1', 'text'), false)
  assert.equal(canEditStreamField('player', 'user-1', 'user-1', 'status'), false)
  assert.equal(canEditStreamField('captain', 'user-2', 'user-1', 'status'), true)
  assert.equal(canEditStreamField('captain', 'user-2', 'user-1', 'result'), false)
  assert.equal(canEditStreamField('admin', 'user-2', null, 'result'), true)
})

test('the YouTube icon uses video_url, then the ended stream link', () => {
  assert.equal(watchUrl('https://youtube.com/watch?v=saved', stream({ status: 'ended', youtube_url: 'https://youtube.com/watch?v=live' })), 'https://youtube.com/watch?v=saved')
  assert.equal(watchUrl(null, stream({ status: 'ended', youtube_url: 'https://youtube.com/watch?v=live' })), 'https://youtube.com/watch?v=live')
  assert.equal(watchUrl(null, stream({ status: 'ready', youtube_url: 'https://youtube.com/watch?v=live' })), null)
})
