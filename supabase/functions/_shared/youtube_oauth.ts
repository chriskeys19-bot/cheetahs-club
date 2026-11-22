export const YOUTUBE_SCOPE = 'https://www.googleapis.com/auth/youtube'
export const OAUTH_CALLBACK_NAME = 'youtube-oauth-callback'
export const BROADCASTS_PAGE = 'https://cheetahs-club.pages.dev/broadcasts'
export const STATE_TTL_SECONDS = 10 * 60

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const OAUTH_RETURN_REASONS = [
  'denied',
  'state',
  'exchange',
  'channel',
  'config',
  'missing_refresh',
  'forbidden',
] as const

export type OauthReturnReason = (typeof OAUTH_RETURN_REASONS)[number]

export function youtubeRedirectUri(supabaseUrl: string): string | null {
  const trimmed = supabaseUrl.trim().replace(/\/$/, '')
  if (!trimmed) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.username || url.password || url.search || url.hash) return null
  return `${url.origin}/functions/v1/${OAUTH_CALLBACK_NAME}`
}

export function broadcastsReturnUrl(result: { ok: true } | { ok: false; reason: string }): string {
  const url = new URL(BROADCASTS_PAGE)
  if (result.ok) {
    url.searchParams.set('youtube', 'connected')
    return url.toString()
  }
  const reason = OAUTH_RETURN_REASONS.includes(result.reason as OauthReturnReason) ? result.reason : 'exchange'
  url.searchParams.set('youtube', 'error')
  url.searchParams.set('reason', reason)
  return url.toString()
}

export function oauthReturnMessage(reason: string | null): string {
  if (reason === 'denied') return 'Google sign-in was cancelled before YouTube was connected.'
  if (reason === 'state') return 'That connection link expired or was already used. Press Connect YouTube again.'
  if (reason === 'channel') {
    return 'YouTube did not return a channel for this account. Connect the CricketCrazeUSA account and try again.'
  }
  if (reason === 'missing_refresh') {
    return 'Google did not return a refresh token. Press Reconnect and accept the consent screen.'
  }
  if (reason === 'config') {
    return 'YouTube OAuth is not configured yet. An admin still needs to set the YouTube client secrets.'
  }
  if (reason === 'forbidden') return 'Only an admin can connect YouTube.'
  return 'YouTube could not be connected. Press Connect YouTube again.'
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let index = 0; index < left.length; index += 1) diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  return diff === 0
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data))
  return new Uint8Array(signature)
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function payloadText(input: { exp: number; nonce: string; uid: string }): string {
  return `{"exp":${input.exp},"nonce":${JSON.stringify(input.nonce)},"uid":${JSON.stringify(input.uid)}}`
}

export type SignedState = {
  state: string
  nonceHash: string
  expiresAt: string
  userId: string
}

export async function signOauthState(input: {
  userId: string
  secret: string
  now?: number
  nonce?: string
}): Promise<SignedState | null> {
  const userId = input.userId.trim().toLowerCase()
  if (!UUID_PATTERN.test(userId) || input.secret.trim().length < 8) return null
  const now = input.now ?? Date.now()
  const exp = Math.floor(now / 1000) + STATE_TTL_SECONDS
  const nonce = input.nonce ?? bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  if (nonce.length < 16 || nonce.length > 128) return null
  const text = payloadText({ exp, nonce, uid: userId })
  const signature = await hmac(input.secret, text)
  const state = `v1.${bytesToBase64Url(new TextEncoder().encode(text))}.${bytesToBase64Url(signature)}`
  return {
    state,
    nonceHash: await sha256Hex(nonce),
    expiresAt: new Date(exp * 1000).toISOString(),
    userId,
  }
}

export type VerifiedState = {
  userId: string
  nonceHash: string
  expiresAt: string
}

export async function verifyOauthState(
  state: string,
  secret: string,
  now = Date.now(),
): Promise<VerifiedState | null> {
  if (secret.trim().length < 8) return null
  const parts = state.split('.')
  if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return null
  const payloadBytes = base64UrlToBytes(parts[1])
  const signature = base64UrlToBytes(parts[2])
  if (!payloadBytes || !signature) return null
  const text = new TextDecoder().decode(payloadBytes)
  const expected = await hmac(secret, text)
  if (!timingSafeEqual(signature, expected)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed as { exp?: unknown; nonce?: unknown; uid?: unknown }
  if (typeof record.exp !== 'number' || !Number.isFinite(record.exp)) return null
  if (record.exp * 1000 + 15_000 < now) return null
  if (typeof record.nonce !== 'string' || record.nonce.length < 16 || record.nonce.length > 128) return null
  if (typeof record.uid !== 'string' || !UUID_PATTERN.test(record.uid)) return null
  return {
    userId: record.uid.toLowerCase(),
    nonceHash: await sha256Hex(record.nonce),
    expiresAt: new Date(record.exp * 1000).toISOString(),
  }
}

export function googleAuthorizeUrl(input: {
  clientId: string
  redirectUri: string
  state: string
}): string | null {
  const clientId = input.clientId.trim()
  if (!clientId || clientId.length > 400) return null
  let redirect: URL
  try {
    redirect = new URL(input.redirectUri)
  } catch {
    return null
  }
  if (redirect.protocol !== 'https:' && redirect.protocol !== 'http:') return null
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirect.toString())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', YOUTUBE_SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', input.state)
  return url.toString()
}

export type OauthTokenResult =
  | { ok: true; accessToken: string; refreshToken: string | null }
  | { ok: false; reason: 'invalid_grant' | 'exchange' }

/** Parse a token response. Callers must not log or return this value. */
export function readOauthToken(body: unknown): OauthTokenResult {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'exchange' }
  const record = body as Record<string, unknown>
  if (typeof record.error === 'string') {
    return { ok: false, reason: record.error === 'invalid_grant' ? 'invalid_grant' : 'exchange' }
  }
  const accessToken = record.access_token
  if (typeof accessToken !== 'string' || accessToken.length < 20 || accessToken.length > 4096) {
    return { ok: false, reason: 'exchange' }
  }
  const refresh = record.refresh_token
  const refreshToken = typeof refresh === 'string' && refresh.length >= 20 && refresh.length <= 4096 ? refresh : null
  return { ok: true, accessToken, refreshToken }
}

export function readChannel(body: unknown): { id: string; title: string } | null {
  if (!body || typeof body !== 'object') return null
  const items = (body as { items?: unknown }).items
  if (!Array.isArray(items) || !items[0] || typeof items[0] !== 'object') return null
  const item = items[0] as { id?: unknown; snippet?: unknown }
  const id = typeof item.id === 'string' ? item.id.trim() : ''
  const title =
    item.snippet && typeof item.snippet === 'object' && typeof (item.snippet as { title?: unknown }).title === 'string'
      ? (item.snippet as { title: string }).title.trim()
      : ''
  if (id.length < 2 || id.length > 128 || title.length < 1 || title.length > 200) return null
  return { id, title }
}
