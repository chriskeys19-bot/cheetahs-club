import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldAttemptSplitwiseEnsure } from '../../../src/lib/splitwiseEnsurePlan.ts'
import {
  ensureOnCooldown,
  ENSURE_COOLDOWN_MS,
  groupMemberRefs,
  interpretAddUser,
  memberIdForEmail,
  moneyToCents,
  normalizeEmail,
  sanitizeVenmoUsername,
  scrubSecret,
  splitPersonName,
  SPLITWISE_ADD_FAILED_MESSAGE,
  SPLITWISE_FORBIDDEN_MESSAGE,
  SPLITWISE_UNAUTHORIZED_MESSAGE,
  usdBalanceCents,
} from './splitwise.ts'

test('moneyToCents reads Splitwise decimal strings', () => {
  assert.equal(moneyToCents('12.50'), 1250)
  assert.equal(moneyToCents('-23.45'), -2345)
  assert.equal(moneyToCents('10'), 1000)
  assert.equal(moneyToCents('10.5'), 1050)
  assert.equal(moneyToCents('0.01'), 1)
  assert.equal(moneyToCents('-0.00'), 0)
  assert.equal(moneyToCents('1.005'), 101)
  assert.equal(moneyToCents('1.004'), 100)
  assert.equal(moneyToCents(12.5), 1250)
  assert.equal(moneyToCents(-23.45), -2345)
  assert.equal(moneyToCents(''), null)
  assert.equal(moneyToCents('12.5.1'), null)
  assert.equal(moneyToCents('1e2'), null)
  assert.equal(moneyToCents('$12'), null)
  assert.equal(moneyToCents('100000001'), null)
})

test('normalizeEmail and venmo handles', () => {
  assert.equal(normalizeEmail('  Ben@Club.Test '), 'ben@club.test')
  assert.equal(normalizeEmail('not-an-email'), null)
  assert.equal(sanitizeVenmoUsername(' @Cheetahs_Club '), 'Cheetahs_Club')
  assert.equal(sanitizeVenmoUsername('bad handle'), null)
  assert.equal(sanitizeVenmoUsername(''), null)
})

test('splitPersonName keeps both Splitwise name fields', () => {
  assert.deepEqual(splitPersonName('  Grace   Hopper ', 'grace@club.test'), { firstName: 'Grace', lastName: 'Hopper' })
  assert.deepEqual(splitPersonName('Priya', 'priya@club.test'), { firstName: 'Priya', lastName: 'Member' })
  assert.deepEqual(splitPersonName('   ', 'ada.lovelace@club.test'), { firstName: 'ada', lastName: 'lovelace' })
  assert.deepEqual(splitPersonName(null, null), { firstName: 'Member', lastName: 'Member' })
})

test('group members match email and stop past 300', () => {
  const parsed = groupMemberRefs([
    { id: 4, email: 'Ada@Club.Test' },
    { id: 4, email: 'duplicate@club.test' },
    { id: '12', email: 'ben@club.test' },
    { id: 0, email: 'nope@club.test' },
  ])
  assert.deepEqual(parsed, {
    members: [
      { id: 4, email: 'ada@club.test' },
      { id: 12, email: 'ben@club.test' },
    ],
    truncated: false,
  })
  assert.equal(memberIdForEmail(parsed?.members ?? [], 'ADA@club.test'), 4)
  assert.equal(memberIdForEmail(parsed?.members ?? [], 'missing@club.test'), null)
  assert.equal(groupMemberRefs(Array.from({ length: 301 }, (_, index) => ({ id: index + 1, email: null })))?.truncated, true)
  assert.equal(groupMemberRefs({}), null)
})

test('interpretAddUser checks success and hides secrets', () => {
  assert.deepEqual(interpretAddUser(429, { success: false }), { kind: 'rate_limit' })
  assert.deepEqual(interpretAddUser(401, { error: 'bad' }), {
    kind: 'unauthorized',
    message: SPLITWISE_UNAUTHORIZED_MESSAGE,
  })
  assert.deepEqual(interpretAddUser(403, null), { kind: 'unauthorized', message: SPLITWISE_FORBIDDEN_MESSAGE })
  assert.deepEqual(interpretAddUser(200, { success: true, user: { id: 55, email: 'a@b.c' } }), {
    kind: 'added',
    userId: 55,
  })
  assert.equal(interpretAddUser(200, { success: true, user: {} }).kind, 'failed')
  assert.deepEqual(
    interpretAddUser(200, { success: false, errors: { base: ['User is already a member of this group'] } }),
    { kind: 'already' },
  )
  assert.deepEqual(interpretAddUser(200, { success: false, errors: { base: ['Group is closed'] } }), {
    kind: 'failed',
    message: 'Group is closed',
  })
  const leaked = interpretAddUser(200, { success: false, errors: { base: ['token sk_live_secretvalue'] } }, [
    'sk_live_secretvalue',
  ])
  assert.deepEqual(leaked, { kind: 'failed', message: SPLITWISE_ADD_FAILED_MESSAGE })
  assert.equal(JSON.stringify(leaked).includes('sk_live_secretvalue'), false)
  assert.equal(scrubSecret('Bearer abcdefghijk and secret-token-value', ['secret-token-value']).includes('secret-token-value'), false)
})

test('ensure cooldown skips a recent error until the window passes', () => {
  const now = Date.parse('2026-11-06T12:00:00.000Z')
  const recent = new Date(now - 60_000).toISOString()
  const old = new Date(now - ENSURE_COOLDOWN_MS - 1).toISOString()
  assert.equal(ensureOnCooldown('Splitwise did not respond. Try again.', recent, now), true)
  assert.equal(ensureOnCooldown('Splitwise did not respond. Try again.', old, now), false)
  assert.equal(ensureOnCooldown(null, recent, now), false)
  assert.equal(
    shouldAttemptSplitwiseEnsure(
      { splitwiseAddedAt: recent, lastError: null, lastAttemptAt: null },
      now,
      true,
    ),
    false,
  )
  assert.equal(
    shouldAttemptSplitwiseEnsure(
      { splitwiseAddedAt: null, lastError: 'nope', lastAttemptAt: recent },
      now,
      false,
    ),
    false,
  )
  assert.equal(
    shouldAttemptSplitwiseEnsure(
      { splitwiseAddedAt: null, lastError: 'nope', lastAttemptAt: recent },
      now,
      true,
    ),
    true,
  )
  assert.equal(shouldAttemptSplitwiseEnsure(null, now, false), true)
})

test('usd balance keeps the sign and ignores zero foreign currency', () => {
  const parsed = usdBalanceCents([
    { currency_code: 'USD', amount: '-15.00' },
    { currency_code: 'EUR', amount: '0.00' },
    { currency_code: 'GBP', amount: '2.00' },
  ])
  assert.deepEqual(parsed, { cents: -1500, nonUsd: ['GBP'] })
  assert.deepEqual(usdBalanceCents([]), { cents: 0, nonUsd: [] })
  assert.equal(usdBalanceCents([{ currency_code: 'USD', amount: 'nope' }]), null)
})
