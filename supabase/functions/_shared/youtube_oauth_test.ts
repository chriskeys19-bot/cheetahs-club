import assert from 'node:assert/strict'
import test from 'node:test'
import { json, redactForLog } from './http.ts'
import {
  broadcastsReturnUrl,
  googleAuthorizeUrl,
  oauthReturnMessage,
  readChannel,
  readOauthToken,
  signOauthState,
  verifyOauthState,
  youtubeRedirectUri,
  YOUTUBE_SCOPE,
} from './youtube_oauth.ts'

const USER = '11111111-1111-4111-8111-111111111111'
const SECRET = 'test-client-secret-value'

test('redirect URI is the callback function on the project', () => {
  assert.equal(
    youtubeRedirectUri('https://lutcbvzunjcosncvdyke.supabase.co/'),
    'https://lutcbvzunjcosncvdyke.supabase.co/functions/v1/youtube-oauth-callback',
  )
  assert.equal(youtubeRedirectUri(''), null)
  assert.equal(youtubeRedirectUri('javascript:alert(1)'), null)
})

test('signed state rejects tampering, expiry, and the wrong secret', async () => {
  const now = Date.parse('2026-11-22T12:00:00Z')
  const signed = await signOauthState({ userId: USER.toUpperCase(), secret: SECRET, now, nonce: 'nonce-value-012345' })
  assert.ok(signed)
  assert.equal(signed.userId, USER)
  const verified = await verifyOauthState(signed.state, SECRET, now)
  assert.equal(verified?.userId, USER)
  assert.equal(verified?.nonceHash, signed.nonceHash)
  assert.equal(await verifyOauthState(signed.state, 'other-client-secret', now), null)
  assert.equal(await verifyOauthState(`${signed.state}x`, SECRET, now), null)
  const [version, payload, signature = ''] = signed.state.split('.')
  const chars = signature.split('')
  chars[4] = chars[4] === 'A' ? 'B' : 'A'
  assert.equal(await verifyOauthState(`${version}.${payload}.${chars.join('')}`, SECRET, now), null)
  assert.equal(await verifyOauthState(signed.state, SECRET, now + 11 * 60 * 1000), null)
  assert.ok(await verifyOauthState(signed.state, SECRET, now + 9 * 60 * 1000))
})

test('authorize URL asks for offline youtube access and does not carry the secret', async () => {
  const signed = await signOauthState({ userId: USER, secret: SECRET, nonce: 'nonce-value-012345' })
  assert.ok(signed)
  const redirect = 'https://lutcbvzunjcosncvdyke.supabase.co/functions/v1/youtube-oauth-callback'
  const url = new URL(googleAuthorizeUrl({ clientId: 'client-id', redirectUri: redirect, state: signed.state }) ?? '')
  assert.equal(url.origin, 'https://accounts.google.com')
  assert.equal(url.searchParams.get('scope'), YOUTUBE_SCOPE)
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('prompt'), 'consent')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('redirect_uri'), redirect)
  assert.equal(url.searchParams.get('client_secret'), null)
  assert.equal(url.toString().includes(SECRET), false)
})

test('token and channel parsers keep failures generic', () => {
  assert.deepEqual(readOauthToken({ error: 'invalid_grant', error_description: 'expired' }), {
    ok: false,
    reason: 'invalid_grant',
  })
  const token = readOauthToken({ access_token: 'ya29.access-token-value', refresh_token: '1//refresh-token-value' })
  assert.equal(token.ok, true)
  if (token.ok) {
    assert.equal(token.refreshToken, '1//refresh-token-value')
  }
  assert.deepEqual(readOauthToken({ access_token: 'short' }), { ok: false, reason: 'exchange' })
  assert.deepEqual(readChannel({ items: [{ id: 'UCcheetahs', snippet: { title: 'CricketCrazeUSA' } }] }), {
    id: 'UCcheetahs',
    title: 'CricketCrazeUSA',
  })
  assert.equal(readChannel({ items: [] }), null)
})

test('the browser returns to the broadcasts page without tokens', () => {
  assert.equal(
    broadcastsReturnUrl({ ok: true }),
    'https://cheetahs-club.pages.dev/broadcasts?youtube=connected',
  )
  const failed = new URL(broadcastsReturnUrl({ ok: false, reason: 'state' }))
  assert.equal(failed.origin + failed.pathname, 'https://cheetahs-club.pages.dev/broadcasts')
  assert.equal(failed.searchParams.get('youtube'), 'error')
  assert.equal(failed.searchParams.get('reason'), 'state')
  assert.equal(failed.searchParams.get('code'), null)
  assert.equal(broadcastsReturnUrl({ ok: false, reason: 'refresh_token=secret' }).includes('refresh_token'), false)
  assert.match(oauthReturnMessage('state'), /expired or was already used/)
  assert.match(oauthReturnMessage('missing_refresh'), /refresh token/)
})

test('json responses refuse token fields and logs are redacted', async () => {
  const request = new Request('https://example.test/youtube-broadcasts', { headers: { Origin: 'https://cheetahs-club.pages.dev' } })
  const blocked = json(request, 200, { refresh_token: '1//should-not-leave' })
  assert.equal(blocked.status, 500)
  const body = await blocked.json()
  assert.equal(JSON.stringify(body).includes('1//'), false)
  const safe = redactForLog('Bearer ya29.access-token-value and 1//refresh-token-value')
  assert.equal(safe.includes('ya29.'), false)
  assert.equal(safe.includes('1//'), false)
})
