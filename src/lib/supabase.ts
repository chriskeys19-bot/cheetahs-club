import { createClient, type SupabaseClient } from '@supabase/supabase-js'

function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]
  return typeof value === 'string' ? value.trim() : ''
}

export const supabaseUrl = readEnv('VITE_SUPABASE_URL')
export const supabaseAnonKey = readEnv('VITE_SUPABASE_ANON_KEY')

export type RecoveryBoot = {
  /** The URL asked for a recovery session. */
  recovery: boolean
  /** Hash or query included an access token for that recovery redirect. */
  hadAccessToken: boolean
  tokenHash: string | null
  error: string | null
}

let recoveryAccessToken: string | null = null
let recoveryRefreshToken: string | null = null
let recoveryApplied = false

function readRecoveryBoot(): RecoveryBoot {
  if (typeof window === 'undefined') {
    return { recovery: false, hadAccessToken: false, tokenHash: null, error: null }
  }
  const hash = new URLSearchParams(window.location.hash.startsWith('#') ? window.location.hash.slice(1) : '')
  const query = new URLSearchParams(window.location.search)
  const type = hash.get('type') ?? query.get('type')
  const tokenHash = query.get('token_hash')
  const accessToken = hash.get('access_token')
  const refreshToken = hash.get('refresh_token')
  const description = hash.get('error_description') ?? query.get('error_description')
  const code = hash.get('error') ?? query.get('error')
  const rawError = (description ?? code ?? '').replaceAll('+', ' ').trim()
  if (type === 'recovery' && accessToken && refreshToken) {
    recoveryAccessToken = accessToken
    recoveryRefreshToken = refreshToken
  }
  return {
    recovery: type === 'recovery',
    hadAccessToken: type === 'recovery' && Boolean(accessToken),
    tokenHash: type === 'recovery' && tokenHash ? tokenHash : null,
    error: rawError || null,
  }
}

// Captured before createClient. The auth client may strip the URL while it
// starts, and PASSWORD_RECOVERY can fire before React subscribes.
export const recoveryBoot: RecoveryBoot = readRecoveryBoot()

export function recoverySessionApplied(accessToken: string | undefined): boolean {
  if (recoveryApplied) return true
  if (!recoveryAccessToken || !accessToken || accessToken !== recoveryAccessToken) return false
  recoveryApplied = true
  recoveryAccessToken = null
  return true
}

export function clearRecoveryMarker(): void {
  recoveryApplied = false
  recoveryAccessToken = null
  recoveryRefreshToken = null
}

/** Apply a recovery redirect while the client stays on PKCE for Google. */
export async function establishRecoverySession(client: SupabaseClient): Promise<string | null> {
  if (!recoveryAccessToken || !recoveryRefreshToken) return null
  const { error } = await client.auth.setSession({
    access_token: recoveryAccessToken,
    refresh_token: recoveryRefreshToken,
  })
  return error ? error.message : null
}

export const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // Google returns a PKCE code to /auth/callback, which exchanges it.
          // Leaving detection off keeps that page in charge of the code.
          // Recovery hash tokens are applied from /reset-password instead.
          detectSessionInUrl: false,
          flowType: 'pkce',
        },
      })
    : null
