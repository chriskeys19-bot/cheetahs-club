import assert from 'node:assert/strict'
import test from 'node:test'
import {
  interpretSheetResponse,
  isAllowedSheetUrl,
  readSyncRequest,
  redirectTarget,
  scrubSheetError,
  secretsMatch,
  sheetRequestBody,
  sheetRowFromFeedback,
} from './logic.ts'

const ID = '11111111-1111-4111-8111-111111111111'

test('cron and backfill requests stay small', () => {
  assert.deepEqual(readSyncRequest({ backfill: true }), { feedbackId: null, backfill: true })
  assert.deepEqual(readSyncRequest({ feedback_id: ID.toUpperCase() }), { feedbackId: ID, backfill: false })
  assert.deepEqual(readSyncRequest({ backfill: true, feedback_id: 'nope' }), { feedbackId: null, backfill: true })
  assert.equal(typeof readSyncRequest({}), 'string')
  assert.equal(typeof readSyncRequest({ backfill: 'yes' }), 'string')
  assert.equal(typeof readSyncRequest(null), 'string')
})

test('a feedback row becomes the five sheet columns and keeps the category tag', () => {
  const row = sheetRowFromFeedback({
    id: ID,
    created_at: '2026-11-12T19:15:00.000Z',
    submitter_name: 'Ben\nClub',
    submitter_email: ' ben@cheetahs.test ',
    role: 'player',
    body: '[Feature] Add a dark mode',
  })
  assert.deepEqual(row, {
    id: ID,
    timestamp: '2026-11-12T19:15:00.000Z',
    submitter_name: 'Ben Club',
    submitter_email: 'ben@cheetahs.test',
    role: 'player',
    suggestion: '[Feature] Add a dark mode',
  })
  const body = JSON.parse(sheetRequestBody('secret-value', [row!])) as { secret: string; rows: { suggestion: string }[] }
  assert.equal(body.secret, 'secret-value')
  assert.equal(body.rows.length, 1)
  assert.equal(body.rows[0]?.suggestion, '[Feature] Add a dark mode')
  assert.equal(sheetRowFromFeedback({ ...row, id: 'nope', body: 'x', created_at: '2026-11-12T19:15:00.000Z' }), null)
})

test('only the Apps Script hosts are called', () => {
  assert.equal(isAllowedSheetUrl('https://script.google.com/macros/s/abc/exec'), true)
  assert.equal(isAllowedSheetUrl('https://script.googleusercontent.com/macros/echo?user_content_key=abc'), true)
  assert.equal(isAllowedSheetUrl('http://script.google.com/macros/s/abc/exec'), false)
  assert.equal(isAllowedSheetUrl('https://script.google.com.evil.test/exec'), false)
  assert.equal(isAllowedSheetUrl('https://user:pw@script.google.com/macros/s/abc/exec'), false)
  assert.equal(
    redirectTarget('https://script.google.com/macros/s/abc/exec', 'https://script.googleusercontent.com/macros/echo'),
    'https://script.googleusercontent.com/macros/echo',
  )
  assert.equal(redirectTarget('https://script.google.com/macros/s/abc/exec', 'https://evil.test/steal'), null)
})

test('a sheet response marks duplicates synced and keeps a failed row unsynced', () => {
  const other = '22222222-2222-4222-8222-222222222222'
  const results = interpretSheetResponse(
    200,
    {
      ok: true,
      results: [
        { id: ID, status: 'duplicate' },
        { id: other, status: 'rejected', error: 'Mail ben@cheetahs.test failed' },
      ],
    },
    [ID, other],
  )
  assert.deepEqual(results, [
    { id: ID, ok: true, error: null },
    { id: other, ok: false, error: 'Mail [email] failed' },
  ])
  const down = interpretSheetResponse(500, { error: 'busy' }, [ID])
  assert.equal(down[0]?.ok, false)
  assert.equal(down[0]?.error, 'busy')
})

test('secret compare rejects a different length and scrubs stored errors', () => {
  assert.equal(secretsMatch('abcdef', 'abcdef'), true)
  assert.equal(secretsMatch('abcdef', 'abcdeg'), false)
  assert.equal(secretsMatch('abc', 'abcdef'), false)
  assert.equal(secretsMatch('', 'abcdef'), false)
  assert.equal(scrubSheetError('  see ben@club.test\nnow  '), 'see [email] now')
})
