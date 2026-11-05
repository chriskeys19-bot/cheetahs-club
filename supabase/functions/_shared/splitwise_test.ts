import assert from 'node:assert/strict'
import test from 'node:test'
import { moneyToCents, normalizeEmail, sanitizeVenmoUsername, usdBalanceCents } from './splitwise.ts'

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
