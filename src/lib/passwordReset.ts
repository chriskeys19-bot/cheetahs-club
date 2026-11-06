import { recoveryBoot, supabase } from './supabase.ts'

const RESET_FAILED = 'The reset link could not be created. Try again.'
const EMAIL_FAILED = 'The reset email did not send. Copy the link and send it on WhatsApp.'

export type PasswordResetResult = {
  link: string | null
  emailed: boolean
  error: string | null
}

export function passwordProblem(password: string, confirm: string): string | null {
  if (password.length < 8 || password.length > 72) return 'Use a password of 8 to 72 characters.'
  if (password !== confirm) return 'Those passwords do not match.'
  return null
}

export function recoveryMessage(raw: string): string {
  const lower = raw.toLowerCase()
  if (
    lower.includes('expired') ||
    lower.includes('invalid') ||
    lower.includes('otp') ||
    lower.includes('token')
  ) {
    return 'This reset link is invalid or has expired. Ask an admin for a new one.'
  }
  return 'This reset link could not be opened. Ask an admin for a new one.'
}

export function passwordUpdateMessage(raw: string): string {
  const lower = raw.toLowerCase()
  if (lower.includes('different') || lower.includes('same password')) {
    return 'Choose a different password from the current one.'
  }
  if (lower.includes('weak') || lower.includes('at least') || lower.includes('characters') || lower.includes('pwned')) {
    return 'Use a password of 8 to 72 characters.'
  }
  if (lower.includes('session') || lower.includes('jwt') || lower.includes('not authenticated')) {
    return 'This reset link is no longer active. Ask an admin for a new one.'
  }
  return 'The password could not be saved. Try again.'
}

function shareableLink(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4000) return null
  try {
    const url = new URL(value)
    if (url.username || url.password) return null
    if (url.protocol === 'https:') return url.toString()
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    if (url.protocol === 'http:' && local) return url.toString()
    return null
  } catch {
    return null
  }
}

async function messageFromInvoke(error: unknown): Promise<string> {
  const context =
    error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
  if (context && typeof context === 'object' && 'json' in context && typeof (context as Response).json === 'function') {
    try {
      const body = await (context as Response).json()
      if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
        const message = (body as { error: string }).error.trim()
        if (message) return message
      }
    } catch {
      return RESET_FAILED
    }
  }
  return RESET_FAILED
}

export async function requestPasswordReset(input: {
  userId: string
  sendEmail: boolean
}): Promise<PasswordResetResult> {
  if (!supabase) return { link: null, emailed: false, error: 'Supabase is not configured.' }
  const { data: sessionData } = await supabase.auth.getSession()
  const accessToken = sessionData.session?.access_token
  if (!accessToken) return { link: null, emailed: false, error: 'Sign in again, then reset the password.' }

  const { data, error } = await supabase.functions.invoke('admin-reset-password', {
    body: { userId: input.userId, sendEmail: input.sendEmail },
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (error) return { link: null, emailed: false, error: await messageFromInvoke(error) }

  const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const link = shareableLink(record?.link)
  const emailed = record?.emailed === true
  const message = typeof record?.message === 'string' && record.message.trim() ? record.message.trim() : null
  if (!link) return { link: null, emailed: false, error: message ?? RESET_FAILED }
  if (input.sendEmail && !emailed) return { link, emailed: false, error: message ?? EMAIL_FAILED }
  return { link, emailed, error: null }
}

let recoveryVerify: Promise<string | null> | null = null

/** Exchange a token_hash once. Strict mode must not burn the one-time token twice. */
export function verifyRecoveryHash(): Promise<string | null> | null {
  const tokenHash = recoveryBoot.tokenHash
  const client = supabase
  if (!tokenHash || !client) return null
  if (!recoveryVerify) {
    recoveryVerify = client.auth
      .verifyOtp({ type: 'recovery', token_hash: tokenHash })
      .then(({ error }) => (error ? recoveryMessage(error.message) : null))
  }
  return recoveryVerify
}
