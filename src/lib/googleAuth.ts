import { supabase, supabaseAnonKey, supabaseUrl } from './supabase.ts'

const INVITE_KEY = 'cheetahs.oauth.invite'
const NOTICE_KEY = 'cheetahs.oauth.notice'
const INVITE_MAX_AGE_MS = 30 * 60 * 1000
const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export const AUTH_CALLBACK_PATH = '/auth/callback'

export type GoogleFinishStatus =
  | 'member'
  | 'joined'
  | 'invite_required'
  | 'email_mismatch'
  | 'invite_unusable'
  | 'no_profile'
  | 'error'

export type GoogleFinishResult = {
  status: GoogleFinishStatus
  message: string | null
}

type StoredInvite = {
  token?: unknown
  at?: unknown
}

export function isGoogleOnlyUser(user: {
  identities?: { provider: string }[] | null
  app_metadata?: { provider?: unknown; providers?: unknown } | null
}): boolean {
  const identities = user.identities ?? []
  if (identities.length > 0) {
    return identities.every((identity) => identity.provider === 'google')
  }
  const providers = user.app_metadata?.providers
  if (Array.isArray(providers) && providers.length > 0) {
    return providers.every((provider) => provider === 'google')
  }
  return user.app_metadata?.provider === 'google'
}

export function rememberInviteToken(token: string): void {
  const payload = JSON.stringify({ token, at: Date.now() })
  sessionStorage.setItem(INVITE_KEY, payload)
  localStorage.setItem(INVITE_KEY, payload)
}

export function readInviteToken(): string | null {
  const raw = sessionStorage.getItem(INVITE_KEY) ?? localStorage.getItem(INVITE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as StoredInvite
    if (typeof parsed.token !== 'string' || typeof parsed.at !== 'number') return null
    if (!TOKEN_PATTERN.test(parsed.token)) return null
    if (Date.now() - parsed.at > INVITE_MAX_AGE_MS) return null
    return parsed.token
  } catch {
    return null
  }
}

export function clearInviteToken(): void {
  sessionStorage.removeItem(INVITE_KEY)
  localStorage.removeItem(INVITE_KEY)
}

export function writeOauthNotice(result: GoogleFinishResult): void {
  sessionStorage.setItem(NOTICE_KEY, JSON.stringify({ status: result.status, message: result.message }))
}

export function peekOauthNotice(): GoogleFinishResult | null {
  const raw = sessionStorage.getItem(NOTICE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { status?: unknown; message?: unknown }
    if (
      parsed.status !== 'invite_required' &&
      parsed.status !== 'email_mismatch' &&
      parsed.status !== 'invite_unusable' &&
      parsed.status !== 'no_profile' &&
      parsed.status !== 'error'
    ) {
      return null
    }
    return {
      status: parsed.status,
      message: typeof parsed.message === 'string' ? parsed.message : null,
    }
  } catch {
    return null
  }
}

export function clearOauthNotice(): void {
  sessionStorage.removeItem(NOTICE_KEY)
}

export function googleRedirectError(raw: string): string {
  const message = raw.replaceAll('+', ' ').trim()
  const lower = message.toLowerCase()
  if (lower.includes('access_denied') || lower.includes('cancel')) {
    return 'Google sign-in was cancelled.'
  }
  if (lower.includes('already') || lower.includes('identity') || lower.includes('registered')) {
    return 'That email already has a password account, and Google was not linked to it. Sign in with your password. Linking only happens when that email is already confirmed.'
  }
  return 'Google sign-in could not be started. Try again, or use your email and password.'
}

function parseFinish(payload: unknown, ok: boolean): GoogleFinishResult {
  const fallback = 'Google sign-in could not be checked. Try again.'
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', message: fallback }
  }
  const row = payload as { status?: unknown; message?: unknown }
  const message = typeof row.message === 'string' && row.message.trim() ? row.message.trim() : null
  if (
    row.status === 'member' ||
    row.status === 'joined' ||
    row.status === 'invite_required' ||
    row.status === 'email_mismatch' ||
    row.status === 'invite_unusable' ||
    row.status === 'no_profile'
  ) {
    return { status: row.status, message }
  }
  return { status: 'error', message: message ?? (ok ? fallback : fallback) }
}

export async function finishGoogleSignIn(token: string | null): Promise<GoogleFinishResult> {
  if (!supabase || !supabaseUrl || !supabaseAnonKey) {
    return { status: 'error', message: 'Supabase is not configured.' }
  }
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) return { status: 'error', message: 'Google sign-in did not start a session.' }

  let response: Response
  try {
    response = await fetch(`${supabaseUrl}/functions/v1/finish-google-signin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(token ? { token } : {}),
    })
  } catch {
    return { status: 'error', message: 'Google sign-in could not be checked. Try again.' }
  }

  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  return parseFinish(payload, response.ok)
}

export async function startGoogleSignIn(inviteToken: string | null): Promise<string | null> {
  if (!supabase) return 'Supabase is not configured.'
  if (inviteToken) rememberInviteToken(inviteToken)
  else clearInviteToken()
  const redirectTo = window.location.origin + AUTH_CALLBACK_PATH
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      queryParams: { prompt: 'select_account' },
    },
  })
  return error ? error.message : null
}
