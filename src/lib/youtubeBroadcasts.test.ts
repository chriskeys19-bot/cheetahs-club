import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canEndBroadcast,
  canStartBroadcast,
  endConfirmCopy,
  groupBroadcasts,
  looksLikePulsePlay,
  matchesFilter,
  startConfirmCopy,
  startNeedsConfirm,
  zonedClock,
  type BroadcastRow,
} from './youtubeBroadcasts.ts'

const NOW = Date.parse('2026-11-26T16:00:00.000Z')

function row(patch: Partial<BroadcastRow>): BroadcastRow {
  return {
    id: 'abcdefghijk',
    title: 'Cheetahs Alpha vs Royals',
    scheduledStart: '2026-11-26T18:30:00.000Z',
    actualStart: null,
    actualEnd: null,
    lifeCycle: 'ready',
    streamKeyName: 'Yolobox Pro 1',
    watchUrl: 'https://www.youtube.com/watch?v=abcdefghijk',
    ...patch,
  }
}

test('start asks for confirmation only more than 15 minutes early', () => {
  assert.equal(startNeedsConfirm('2026-11-26T16:16:00.000Z', NOW), true)
  assert.equal(startNeedsConfirm('2026-11-26T16:15:00.000Z', NOW), false)
  assert.equal(startNeedsConfirm('2026-11-26T16:10:00.000Z', NOW), false)
  assert.equal(startNeedsConfirm('2026-11-26T15:00:00.000Z', NOW), false)
  assert.equal(startNeedsConfirm(null, NOW), true)
  assert.equal(startNeedsConfirm('not-a-time', NOW), true)
})

test('confirm copy names the game, the Central time, and the stream key', () => {
  const early = startConfirmCopy(row({ title: 'Pulse Play vs Hawks', streamKeyName: 'PSD Key 1' }))
  assert.match(early.body, /Pulse Play vs Hawks/)
  assert.match(early.body, /PSD Key 1/)
  assert.match(early.body, /12:30 PM CST/)
  const ended = endConfirmCopy(row({ title: 'Pulse Play vs Hawks' }))
  assert.match(ended.body, /Pulse Play vs Hawks/)
  assert.equal(ended.body.includes('PSD'), false)
})

test('PSD rows show Central and Pacific clocks', () => {
  const central = zonedClock('2026-11-26T18:30:00.000Z', 'America/Chicago')
  const pacific = zonedClock('2026-11-26T18:30:00.000Z', 'America/Los_Angeles')
  assert.equal(central?.dayKey, '2026-11-26')
  assert.match(central?.timeLabel ?? '', /12:30 PM/)
  assert.match(pacific?.timeLabel ?? '', /10:30 AM/)
  assert.equal(looksLikePulsePlay('Cheetahs vs Hawks', 'PSD Key 1'), true)
  assert.equal(looksLikePulsePlay('Pulse Play final', null), true)
  assert.equal(looksLikePulsePlay('Cheetahs Alpha vs Royals', 'Yolobox Pro 1'), false)
})

test('filters keep today and upcoming, live, and recent ended apart', () => {
  const upcoming = row({ id: 'upcoming111', lifeCycle: 'ready', scheduledStart: '2026-11-27T18:00:00.000Z' })
  const today = row({ id: 'today111111', lifeCycle: 'ready', scheduledStart: '2026-11-26T20:00:00.000Z' })
  const yesterday = row({ id: 'yesterday11', lifeCycle: 'ready', scheduledStart: '2026-11-25T18:00:00.000Z' })
  const live = row({ id: 'live1111111', lifeCycle: 'live', scheduledStart: '2026-11-26T15:00:00.000Z' })
  const ended = row({
    id: 'ended111111',
    lifeCycle: 'complete',
    scheduledStart: '2026-11-25T18:00:00.000Z',
    actualEnd: '2026-11-25T21:00:00.000Z',
  })
  const old = row({
    id: 'old11111111',
    lifeCycle: 'complete',
    scheduledStart: '2026-10-01T18:00:00.000Z',
    actualEnd: '2026-10-01T21:00:00.000Z',
  })
  const rows = [upcoming, today, yesterday, live, ended, old]
  const grouped = groupBroadcasts(rows, 'upcoming', NOW)
  const ids = grouped.flatMap((group) => group.rows.map((item) => item.id))
  assert.deepEqual(ids, ['live1111111', 'today111111', 'upcoming111'])
  assert.equal(grouped[0]?.dayLabel.includes('Thursday'), true)
  assert.deepEqual(
    groupBroadcasts(rows, 'live', NOW).flatMap((group) => group.rows.map((item) => item.id)),
    ['live1111111'],
  )
  assert.deepEqual(
    groupBroadcasts(rows, 'ended', NOW).flatMap((group) => group.rows.map((item) => item.id)),
    ['ended111111'],
  )
  assert.equal(matchesFilter(yesterday, 'upcoming', NOW), false)
  assert.equal(canStartBroadcast('ready'), true)
  assert.equal(canStartBroadcast('live'), false)
  assert.equal(canEndBroadcast('live'), true)
  assert.equal(canEndBroadcast('ready'), false)
  assert.equal(canEndBroadcast('testing'), true)
})
