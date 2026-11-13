import assert from 'node:assert/strict'
import test from 'node:test'
import {
  formatLocalDateTime,
  missingNewSyncColumns,
  splitwiseSyncLabel,
  splitwiseSyncSourceLabel,
} from './splitwiseSyncLabel.ts'

const SYNCED = '2026-11-13T03:15:00.000Z'

test('last synced uses the viewer zone and a short zone name', () => {
  assert.equal(
    splitwiseSyncLabel({ syncedAt: SYNCED, lastAttemptFailed: false, timeZone: 'America/Los_Angeles' }),
    'Last synced Nov 12, 2026, 7:15 PM PST',
  )
  assert.equal(
    formatLocalDateTime(SYNCED, 'America/New_York'),
    'Nov 12, 2026, 10:15 PM EST',
  )
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
  assert.equal(formatLocalDateTime(SYNCED), formatLocalDateTime(SYNCED, zone))
})

test('never synced and a failed attempt stay readable', () => {
  assert.equal(splitwiseSyncLabel({ syncedAt: null, lastAttemptFailed: false }), 'Not synced yet.')
  assert.equal(
    splitwiseSyncLabel({
      syncedAt: null,
      lastAttemptFailed: true,
      lastAttemptAt: '2026-11-13T16:00:00.000Z',
      timeZone: 'America/Los_Angeles',
    }),
    'Not synced yet. The last attempt failed at Nov 13, 2026, 8:00 AM PST.',
  )
  assert.equal(
    splitwiseSyncLabel({
      syncedAt: SYNCED,
      lastAttemptFailed: true,
      lastAttemptAt: '2026-11-13T16:00:00.000Z',
      groupName: 'Cheetahs',
      timeZone: 'America/Los_Angeles',
    }),
    'Last synced Nov 12, 2026, 7:15 PM PST · Cheetahs. The latest attempt failed at Nov 13, 2026, 8:00 AM PST, so this copy may be out of date.',
  )
  assert.equal(splitwiseSyncLabel({ syncedAt: 'not-a-date', lastAttemptFailed: false }), 'Not synced yet.')
})

test('sync source labels and a missing-column error', () => {
  assert.equal(splitwiseSyncSourceLabel('scheduled'), 'Scheduled sync.')
  assert.equal(splitwiseSyncSourceLabel('manual'), 'Manual refresh.')
  assert.equal(splitwiseSyncSourceLabel('service'), 'Refresh after a member was added.')
  assert.equal(splitwiseSyncSourceLabel(null), null)
  assert.equal(missingNewSyncColumns('column splitwise_meta.sync_source does not exist'), true)
  assert.equal(
    missingNewSyncColumns("Could not find the 'last_attempt_failed' column of 'splitwise_meta' in the schema cache"),
    true,
  )
  assert.equal(missingNewSyncColumns('permission denied for table splitwise_meta'), false)
})
