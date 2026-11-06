import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLUB_MAILBOX,
  EMAIL_NOT_CONFIGURED,
  buildResetMessage,
  linkFailure,
  resolveAppOrigin,
  resetRedirect,
  smtpConfigured,
  validateRecoveryLink,
} from './logic.ts'

const API = 'https://lutcbvzunjcosncvdyke.supabase.co'
const REDIRECT = 'https://cheetahs-club.pages.dev/reset-password'

test('origin falls back to the club site', () => {
  assert.equal(resolveAppOrigin(undefined), 'https://cheetahs-club.pages.dev')
  assert.equal(resolveAppOrigin('https://evil.example'), 'https://cheetahs-club.pages.dev')
  assert.equal(resolveAppOrigin('http://localhost:5173'), 'http://localhost:5173')
  assert.equal(resetRedirect('https://cheetahs-club.pages.dev'), REDIRECT)
})

test('recovery link must be this project verify URL for the reset page', () => {
  const token = 'a'.repeat(32)
  const good = `${API}/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(REDIRECT)}`
  assert.equal(validateRecoveryLink(good, API, REDIRECT), good)
  assert.equal(validateRecoveryLink(good, API, 'https://cheetahs-club.pages.dev/login'), null)
  assert.equal(
    validateRecoveryLink(`${API}/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent(REDIRECT)}`, API, REDIRECT),
    null,
  )
  assert.equal(
    validateRecoveryLink(`https://evil.example/auth/v1/verify?token=${token}&type=recovery&redirect_to=${encodeURIComponent(REDIRECT)}`, API, REDIRECT),
    null,
  )
  assert.equal(validateRecoveryLink('javascript:alert(1)', API, REDIRECT), null)
  assert.equal(validateRecoveryLink(`${API}/auth/v1/verify?type=recovery&redirect_to=${encodeURIComponent(REDIRECT)}`, API, REDIRECT), null)
})

test('smtp stays on the club mailbox', () => {
  assert.equal(smtpConfigured('someone@gmail.com', 'abcdefgh'), null)
  assert.equal(smtpConfigured(CLUB_MAILBOX, 'short'), null)
  assert.deepEqual(smtpConfigured(` ${CLUB_MAILBOX} `, 'abcd efgh'), {
    user: CLUB_MAILBOX,
    pass: 'abcdefgh',
  })
})

test('reset email escapes the name and keeps the link', () => {
  const link = `${API}/auth/v1/verify?token=${'b'.repeat(24)}&type=recovery&redirect_to=${encodeURIComponent(REDIRECT)}`
  const message = buildResetMessage({
    link,
    name: '<script>',
    fromName: 'Cheetahs Cricket Club',
  })
  assert.equal(message.subject, 'Reset your Cheetahs Cricket Club password')
  assert.match(message.text, /Hello <script>,/)
  assert.match(message.html, /Hello &lt;script&gt;,/)
  assert.equal(message.html.includes('<script>'), false)
  assert.match(message.html, /#28264C/)
  assert.match(message.html, /#D4A05C/)
  assert.match(message.html, /#FCF6EE/)
  assert.match(message.text, new RegExp(link.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.equal(message.text.includes('password123'), false)
})

test('link failures stay generic', () => {
  assert.match(linkFailure('redirect_to not allowed'), /redirect allow list/)
  assert.match(linkFailure('rate limit exceeded'), /Wait a moment/)
  assert.equal(linkFailure('user foo@bar.com missing'), 'The reset link could not be created. Try again.')
  assert.match(EMAIL_NOT_CONFIGURED, /WhatsApp/)
})
