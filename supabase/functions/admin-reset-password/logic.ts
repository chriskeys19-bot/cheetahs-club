export const CLUB_MAILBOX = 'cheetahscc123@gmail.com'
export const DEFAULT_FROM_NAME = 'Cheetahs Cricket Club'
export const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'

export const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const EMAIL_NOT_CONFIGURED =
  'Password reset email is not set up yet. Copy the link and send it on WhatsApp.'
export const EMAIL_SEND_FAILED =
  'The reset email did not send. Copy the link and send it on WhatsApp.'

export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

export function resolveAppOrigin(raw: string | undefined): string {
  const cleaned = headerSafe(raw ?? '')
  if (ALLOWED_ORIGINS.has(cleaned)) return cleaned
  return DEFAULT_ORIGIN
}

export function resetRedirect(origin: string): string {
  return `${origin}/reset-password`
}

export function validateRecoveryLink(
  link: string,
  supabaseUrl: string,
  redirectTo: string,
): string | null {
  let url: URL
  let api: URL
  let expected: URL
  try {
    url = new URL(link)
    api = new URL(supabaseUrl)
    expected = new URL(redirectTo)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && api.protocol === 'https:') return null
  if (url.origin !== api.origin) return null
  if (url.pathname !== '/auth/v1/verify') return null
  if (url.searchParams.get('type') !== 'recovery') return null
  if (url.username || url.password || url.hash) return null
  const token = url.searchParams.get('token') ?? url.searchParams.get('token_hash')
  if (!token || token.length < 16 || token.length > 2048) return null
  const redirect = url.searchParams.get('redirect_to')
  if (!redirect) return null
  let redirectUrl: URL
  try {
    redirectUrl = new URL(redirect)
  } catch {
    return null
  }
  if (redirectUrl.origin !== expected.origin) return null
  if (redirectUrl.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) return null
  if (redirectUrl.username || redirectUrl.password || redirectUrl.search || redirectUrl.hash) return null
  return url.toString()
}

export function smtpConfigured(user: string, pass: string): { user: string; pass: string } | null {
  const mailbox = user.trim().toLowerCase()
  const secret = pass.replace(/\s+/g, '')
  if (mailbox !== CLUB_MAILBOX || secret.length < 8) return null
  return { user: mailbox, pass: secret }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function linkFailure(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('redirect')) {
    return 'Add the reset page to the Supabase redirect allow list, then try again.'
  }
  if (lower.includes('rate') || lower.includes('once every') || lower.includes('too many')) {
    return 'Wait a moment, then create another reset link.'
  }
  return 'The reset link could not be created. Try again.'
}

export function buildResetMessage(input: {
  link: string
  name: string | null
  fromName: string
}): { subject: string; text: string; html: string } {
  const fromName = headerSafe(input.fromName) || DEFAULT_FROM_NAME
  const name = headerSafe(input.name ?? '').slice(0, 80)
  const greeting = name ? `Hello ${name},` : 'Hello,'
  const subject = 'Reset your Cheetahs Cricket Club password'
  const text = [
    greeting,
    '',
    'An admin at Cheetahs Cricket Club created a password reset link for you.',
    'Open it and choose a new password. Your current password stays until you do.',
    '',
    input.link,
    '',
    'The link works once, then it expires. If you did not expect this, you can ignore it.',
    '',
    fromName,
  ].join('\n')

  const safeLink = escapeHtml(input.link)
  const safeGreeting = escapeHtml(greeting)
  const safeName = escapeHtml(fromName)
  const html = [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<body style="margin:0;background:#FCF6EE;color:#28264C;font-family:Georgia,Times New Roman,serif;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FCF6EE;padding:24px 12px;">',
    '<tr><td align="center">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #D4A05C;border-radius:16px;">',
    '<tr><td style="padding:28px 24px;">',
    '<p style="margin:0 0 8px;letter-spacing:0.14em;text-transform:uppercase;color:#D4A05C;font-weight:700;font-size:12px;font-family:Arial,sans-serif;">Cheetahs Cricket Club</p>',
    '<h1 style="margin:0 0 12px;color:#28264C;font-size:28px;line-height:1.1;">Set a new password</h1>',
    `<p style="margin:0 0 12px;font-size:16px;line-height:1.5;">${safeGreeting}</p>`,
    '<p style="margin:0 0 18px;font-size:16px;line-height:1.5;">An admin created a password reset link for you. Open it and choose a new password. Your current password stays until you do.</p>',
    `<p style="margin:0 0 18px;"><a href="${safeLink}" style="display:inline-block;background:#D4A05C;color:#28264C;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:999px;font-family:Arial,sans-serif;">Set a new password</a></p>`,
    `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;">Or copy this link:<br /><a href="${safeLink}" style="color:#28264C;">${safeLink}</a></p>`,
    '<p style="margin:0;font-size:14px;line-height:1.5;">The link works once, then it expires. If you did not expect this, you can ignore it.</p>',
    `<p style="margin:18px 0 0;font-size:14px;color:#28264C;">${safeName}</p>`,
    '</td></tr></table></td></tr></table></body></html>',
  ].join('\n')

  return { subject, text, html }
}
