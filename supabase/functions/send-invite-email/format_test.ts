import assert from 'node:assert/strict'
import test from 'node:test'
import { formatExpiry } from './format.ts'

test('invite expiry is a readable Pacific clock with the short zone name', () => {
  assert.equal(formatExpiry('2026-11-14T00:56:00.000Z'), 'Fri, Nov 13, 2026, 4:56 PM PST')
  assert.equal(formatExpiry('2026-07-13T23:56:00.000Z'), 'Mon, Jul 13, 2026, 4:56 PM PDT')
  assert.equal(formatExpiry('2026-11-14T00:05:00.000Z'), 'Fri, Nov 13, 2026, 4:05 PM PST')
})

test('a bad timestamp falls back instead of throwing', () => {
  assert.equal(formatExpiry('not-a-date'), 'in 7 days')
  assert.equal(formatExpiry(''), 'in 7 days')
})

test('dateStyle and timeStyle together with timeZoneName are rejected', () => {
  assert.throws(
    () =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles',
        dateStyle: 'full',
        timeStyle: 'short',
        timeZoneName: 'short',
      }).format(new Date('2026-11-14T00:56:00.000Z')),
    (error: unknown) => error instanceof Error && /Invalid option/.test(error.message),
  )
})
