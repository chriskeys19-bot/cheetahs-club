import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canEditStreamField,
  isPublicStreamStatus,
  liveStreamMessage,
  overlayUrlFromScorecard,
  parseStreamScorecardUrl,
  preferredOverlayUrl,
  retryAction,
  shouldAutoCheck,
  canManuallyEndStream,
  shouldAutoEnd,
  failedStreamChipHidden,
  streamControlVisible,
  streamNeedsLiveRefresh,
  streamWithEarlyOverlay,
  CHECKING_LABEL,
  NOT_FOUND_LABEL,
  STREAM_CHECK_INTERVAL_MS,
  UPDATING_STREAM_LABEL,
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
  checked_at: null,
  created_at: '2026-11-07T00:00:00Z',
  updated_at: '2026-11-07T00:00:00Z',
  ...patch,
})

test('a check job says it is looking on CricketCrazeUSA', () => {
  const live = liveStreamMessage(stream({ status: 'checking', checked_at: '2026-11-07T18:00:00Z' }), {
    status: 'pending',
    action: 'check',
    error: null,
  })
  assert.equal(live.label, CHECKING_LABEL)
  assert.equal(live.phase, 'checking')
  assert.equal(live.busy, true)
})

test('a finished check with no stream offers to create one', () => {
  const live = liveStreamMessage(stream({ status: 'none', checked_at: '2026-11-07T18:00:00Z' }), null)
  assert.equal(live.label, NOT_FOUND_LABEL)
  assert.equal(live.phase, 'create')
  assert.equal(live.busy, false)
})

test('a failed check keeps Retry and does not hide create', () => {
  const row = stream({ status: 'failed', last_error: 'CricketCrazeUSA did not respond.', checked_at: '2026-11-07T18:00:00Z' })
  const live = liveStreamMessage(row, { status: 'failed', action: 'check', error: 'CricketCrazeUSA did not respond.' })
  assert.equal(live.phase, 'check_failed')
  assert.equal(live.label, 'Setup failed: CricketCrazeUSA did not respond.')
  assert.equal(retryAction(row, { status: 'failed', action: 'check' }), 'check')
})

test('automatic checks wait 10 minutes after the last lookup', () => {
  const now = Date.parse('2026-11-07T18:20:00Z')
  assert.equal(shouldAutoCheck(null, false, now), true)
  assert.equal(shouldAutoCheck(stream({ status: 'none', checked_at: null }), false, now), true)
  assert.equal(
    shouldAutoCheck(stream({ status: 'none', checked_at: '2026-11-07T18:15:00Z' }), false, now),
    false,
  )
  assert.equal(
    shouldAutoCheck(
      stream({ status: 'none', checked_at: new Date(now - STREAM_CHECK_INTERVAL_MS - 1000).toISOString() }),
      false,
      now,
    ),
    true,
  )
  assert.equal(shouldAutoCheck(stream({ status: 'checking', checked_at: '2026-11-07T17:00:00Z' }), false, now), false)
  assert.equal(
    shouldAutoCheck(stream({ status: 'none', youtube_url: 'https://youtu.be/abcdefghijk', checked_at: null }), false, now),
    false,
  )
  assert.equal(shouldAutoCheck(null, true, now), false)
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

test('setting up with a saved overlay uses the finishing label', () => {
  const live = liveStreamMessage(
    stream({
      status: 'setting_up_overlay',
      overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712',
    }),
    { status: 'running', action: 'add_scorecard', error: null },
  )
  assert.equal(live.phase, 'updating')
  assert.equal(live.label, UPDATING_STREAM_LABEL)
})

test('an overlay link switches the card to the finishing label', () => {
  const row = stream({
    status: 'updating_stream',
    overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712',
    overlay_short_url: 'https://is.gd/cheetahs42',
  })
  const live = liveStreamMessage(row, { status: 'running', action: 'add_scorecard', error: null })
  assert.equal(live.phase, 'updating')
  assert.equal(live.label, UPDATING_STREAM_LABEL)
  assert.equal(live.busy, true)
  assert.equal(preferredOverlayUrl(row), 'https://is.gd/cheetahs42')
})

test('a saved overlay stays visible when the second phase fails', () => {
  const row = stream({
    status: 'failed',
    youtube_url: 'https://youtube.com/watch?v=abc',
    scorecard_url: 'https://cricclubs.com/NCCA/viewScorecard.do?matchId=987&clubId=1712',
    overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712',
    overlay_short_url: 'https://is.gd/cheetahs42',
    last_error: 'YouTube description was not updated.',
  })
  const live = liveStreamMessage(row, { status: 'failed', action: 'add_scorecard', error: 'YouTube description was not updated.' })
  assert.equal(live.phase, 'failed')
  assert.equal(live.label, 'Setup failed: YouTube description was not updated.')
  assert.equal(preferredOverlayUrl(row), 'https://is.gd/cheetahs42')
  assert.equal(retryAction(row, { status: 'failed', action: 'add_scorecard' }), 'add_scorecard')
})

test('direct scorecard links build an overlay before the worker runs', () => {
  assert.equal(
    overlayUrlFromScorecard('https://cricclubs.com/NCCA/viewScorecard.do?clubId=1712&matchId=987'),
    'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712',
  )
  assert.equal(
    overlayUrlFromScorecard('http://www.cricclubs.com/Cheetahs/viewScorecard.do?matchId=42&clubId=7'),
    'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=42&clubId=7',
  )
  assert.equal(overlayUrlFromScorecard('https://cricclubs.com/NCCA/results/abc123'), null)
  assert.equal(overlayUrlFromScorecard('https://cricclubs.com/NCCA/viewScorecard.do?matchId=42'), null)
  const early = 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=987&clubId=1712'
  const pending = streamWithEarlyOverlay(
    stream({ overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=1&clubId=2', overlay_short_url: 'https://is.gd/old' }),
    early,
  )
  assert.equal(pending?.overlay_url, early)
  assert.equal(pending?.overlay_short_url, null)
  assert.equal(streamWithEarlyOverlay(stream({ overlay_url: early, overlay_short_url: 'https://is.gd/new' }), early)?.overlay_short_url, 'https://is.gd/new')
  const published = streamWithEarlyOverlay(
    stream({
      status: 'failed',
      overlay_url: 'https://static.cricclubs.com/overlay-cc/CC_1712/ccindex.html?matchId=5&clubId=6',
      overlay_short_url: 'https://is.gd/kept',
    }),
    early,
  )
  assert.equal(published?.overlay_short_url, 'https://is.gd/kept')
})

test('scorecard setup keeps polling until the overlay job finishes', () => {
  assert.equal(streamNeedsLiveRefresh([stream({ status: 'updating_stream' })], []), true)
  assert.equal(streamNeedsLiveRefresh([stream({ status: 'setting_up_overlay' })], []), true)
  assert.equal(streamNeedsLiveRefresh([stream({ status: 'ready' })], [{ action: 'add_scorecard', status: 'running' }]), true)
  assert.equal(streamNeedsLiveRefresh([stream({ status: 'ready' })], [{ action: 'add_scorecard', status: 'done' }]), false)
  assert.equal(isPublicStreamStatus('updating_stream'), true)
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
    streamControlVisible({ cheetahsLeague: true, completed: true, status: 'ended', role: 'captain' }),
    true,
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

test('a failed stream chip leaves the card after the match day or a posted result', () => {
  const nov8 = Date.parse('2026-11-08T20:00:00Z')
  assert.equal(
    failedStreamChipHidden({ status: 'failed', completed: false, gameDate: '2026-11-01', asOf: nov8 }),
    true,
  )
  assert.equal(
    failedStreamChipHidden({ status: 'failed', completed: true, gameDate: '2026-11-08', asOf: nov8 }),
    true,
  )
  assert.equal(
    failedStreamChipHidden({ status: 'failed', completed: false, gameDate: '2026-11-08', asOf: nov8 }),
    false,
  )
  assert.equal(
    failedStreamChipHidden({ status: 'ready', completed: true, gameDate: '2026-11-01', asOf: nov8 }),
    false,
  )
})

test('opening a completed stream queues end once', () => {
  const row = stream({ status: 'ready', youtube_url: 'https://youtube.com/watch?v=abc' })
  assert.equal(shouldAutoEnd(true, row, false), true)
  assert.equal(shouldAutoEnd(true, row, true), false)
  assert.equal(shouldAutoEnd(false, row, false), false)
  assert.equal(shouldAutoEnd(true, stream({ status: 'ended', youtube_url: 'https://youtube.com/watch?v=abc' }), false), false)
})

test('an admin can end the ready Tracy Centurions stream when no job is open', () => {
  const row = stream({
    id: '273c75ef-a021-4948-ac78-92ec49464886',
    status: 'ready',
    youtube_url: 'https://www.youtube.com/watch?v=adkJ6snKORQ',
    youtube_video_id: 'adkJ6snKORQ',
  })
  assert.equal(canManuallyEndStream('admin', row, false), true)
  assert.equal(canManuallyEndStream('captain', row, false), true)
  assert.equal(canManuallyEndStream('player', row, false), false)
  assert.equal(canManuallyEndStream('admin', row, true), false)
  assert.equal(canManuallyEndStream('admin', { ...row, status: 'ended' }, false), false)
})

test('manual end is captains and admins while a YouTube video is up', () => {
  const live = stream({ status: 'ready', youtube_url: 'https://youtube.com/watch?v=abc' })
  assert.equal(canManuallyEndStream('captain', live, false), true)
  assert.equal(canManuallyEndStream('admin', live, false), true)
  assert.equal(canManuallyEndStream('player', live, false), false)
  assert.equal(canManuallyEndStream(undefined, live, false), false)
  assert.equal(canManuallyEndStream('captain', live, true), false)
  assert.equal(canManuallyEndStream('captain', null, false), false)
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'ended', youtube_url: 'https://youtube.com/watch?v=abc' }), false),
    false,
  )
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'ending', youtube_video_id: 'abc' }), false),
    false,
  )
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'none', youtube_url: 'https://youtube.com/watch?v=abc' }), false),
    false,
  )
  assert.equal(canManuallyEndStream('captain', stream({ status: 'ready' }), false), false)
  assert.equal(
    canManuallyEndStream('admin', stream({ status: 'awaiting_scorecard', youtube_video_id: 'abc' }), false),
    true,
  )
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'failed', youtube_url: 'https://youtube.com/watch?v=abc' }), false),
    true,
  )
  assert.equal(canManuallyEndStream('captain', stream({ status: 'failed' }), false), false)
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'setting_up_overlay', youtube_url: 'https://youtube.com/watch?v=abc' }), false),
    true,
  )
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'updating_stream', youtube_url: 'https://youtube.com/watch?v=abc' }), false),
    true,
  )
  assert.equal(
    canManuallyEndStream('captain', stream({ status: 'updating_stream', youtube_url: 'https://youtube.com/watch?v=abc' }), true),
    false,
  )
  assert.equal(shouldAutoEnd(true, stream({ status: 'updating_stream', youtube_url: 'https://youtube.com/watch?v=abc' }), true), false)
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
