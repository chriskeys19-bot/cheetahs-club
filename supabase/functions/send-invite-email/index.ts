import { createClient } from 'npm:@supabase/supabase-js@2.81.1'
import nodemailer from 'npm:nodemailer@6.10.1'
import { formatExpiry } from './format.ts'

// Gmail SMTP for cheetahscc123@gmail.com.
// Supabase Edge blocks outbound ports 25 and 587. Port 465 (implicit TLS)
// is the Gmail port that the runtime allows. Secrets, never source:
// INVITE_SMTP_USER, INVITE_SMTP_PASS, optional INVITE_FROM_NAME, optional APP_ORIGIN.

const CLUB_MAILBOX = 'cheetahscc123@gmail.com'
const DEFAULT_FROM_NAME = 'Cheetahs Cricket Club'
const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

const NOT_CONFIGURED = 'Invite email is not set up yet. Copy the join link and send it yourself.'
const SEND_FAILED = 'The invite is saved, but the email did not send. Copy the join link and send it yourself.'

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? ''
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : DEFAULT_ORIGIN
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  }
}

function json(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function appOrigin(): string {
  const raw = headerSafe(Deno.env.get('APP_ORIGIN') ?? DEFAULT_ORIGIN)
  if (ALLOWED_ORIGINS.has(raw)) return raw
  return DEFAULT_ORIGIN
}

function smtpSettings(): { user: string; pass: string; fromName: string } | null {
  const user = (Deno.env.get('INVITE_SMTP_USER') ?? '').trim().toLowerCase()
  const pass = (Deno.env.get('INVITE_SMTP_PASS') ?? '').replace(/\s+/g, '')
  const fromName = headerSafe(Deno.env.get('INVITE_FROM_NAME') ?? DEFAULT_FROM_NAME) || DEFAULT_FROM_NAME
  if (user !== CLUB_MAILBOX || pass.length < 8) {
    console.error('invite email is not configured')
    return null
  }
  return { user, pass, fromName }
}

function logSendFailure(error: unknown, pass: string): void {
  const raw = error instanceof Error ? error.message : 'send failed'
  const clean = pass ? raw.split(pass).join('[redacted]') : raw
  console.error('invite email send failed', clean.slice(0, 300))
}

type InviteMail = {
  email: string
  token: string
  expiresAt: string
  teamName: string | null
}

function buildMessage(invite: InviteMail, fromName: string): { subject: string; text: string; html: string } {
  const url = `${appOrigin()}/join/${invite.token}`
  const when = formatExpiry(invite.expiresAt)
  const sideLine = invite.teamName ? `You'll be with ${invite.teamName}.` : 'No side is chosen yet. A captain can add you later.'
  const subject = invite.teamName
    ? `You're invited to play with ${headerSafe(invite.teamName)}`
    : "You're invited to Cheetahs Cricket Club"

  const text = [
    'Hello,',
    '',
    'A captain at Cheetahs Cricket Club invited you to join.',
    "You'll come in as a player. Open the link, enter your name, and choose a password.",
    '',
    sideLine,
    '',
    'Join the club:',
    url,
    '',
    `This link expires ${when} and works once. It creates a player account. It does not make you a captain or an admin.`,
    '',
    'If this note was not meant for you, you can ignore it.',
    '',
    fromName,
  ].join('\n')

  const safeUrl = escapeHtml(url)
  const safeSide = escapeHtml(sideLine)
  const safeWhen = escapeHtml(when)
  const safeName = escapeHtml(fromName)
  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#F7F4EA;color:#202050;font-family:Georgia,'Times New Roman',serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F4EA;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-top:4px solid #D0A050;border-radius:16px;">
            <tr>
              <td style="padding:28px 24px;">
                <p style="margin:0 0 8px;letter-spacing:0.14em;text-transform:uppercase;color:#D0A050;font-weight:700;font-size:12px;font-family:Arial,sans-serif;">Cheetahs Cricket Club</p>
                <h1 style="margin:0 0 12px;color:#202050;font-size:28px;line-height:1.1;">You're invited</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">A captain saved you a place. Open the link, enter your name, and choose a password. You'll have a player account.</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.5;">${safeSide}</p>
                <p style="margin:0 0 18px;">
                  <a href="${safeUrl}" style="display:inline-block;background:#D0A050;color:#202050;font-weight:700;text-decoration:none;padding:12px 18px;border-radius:999px;font-family:Arial,sans-serif;">Join the club</a>
                </p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">Or copy this link:<br /><a href="${safeUrl}" style="color:#202050;">${safeUrl}</a></p>
                <p style="margin:0 0 12px;font-size:14px;line-height:1.5;">This link expires ${safeWhen} and works once. It creates a player account. It does not make you a captain or an admin.</p>
                <p style="margin:0;font-size:14px;line-height:1.5;">If this note was not meant for you, you can ignore it.</p>
                <p style="margin:18px 0 0;font-size:14px;color:#202050;">${safeName}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

  return { subject, text, html }
}

type MailTransport = {
  sendMail: (message: Record<string, unknown>) => Promise<unknown>
}

function createTransport(options: Record<string, unknown>): MailTransport {
  const candidate = nodemailer as {
    createTransport?: (options: Record<string, unknown>) => MailTransport
    default?: { createTransport?: (options: Record<string, unknown>) => MailTransport }
  }
  const factory = candidate.createTransport ?? candidate.default?.createTransport
  if (!factory) throw new Error('SMTP client is unavailable')
  return factory(options)
}

async function sendClubMail(invite: InviteMail, settings: { user: string; pass: string; fromName: string }): Promise<void> {
  const message = buildMessage(invite, settings.fromName)
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
  await transport.sendMail({
    from: { name: settings.fromName, address: CLUB_MAILBOX },
    to: invite.email,
    replyTo: CLUB_MAILBOX,
    subject: message.subject,
    text: message.text,
    html: message.html,
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) {
    return json(req, 401, { error: 'Sign in again, then send the invite.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  if (!supabaseUrl || !anonKey) return json(req, 500, { error: SEND_FAILED })

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) return json(req, 401, { error: 'Sign in again, then send the invite.' })

  const profileResult = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  const role = profileResult.data?.role
  if (profileResult.error || (role !== 'admin' && role !== 'captain')) {
    return json(req, 403, { error: 'Captains and admins can send invites.' })
  }

  const text = await req.text()
  if (text.length > 4000) return json(req, 413, { error: 'Request is too large.' })
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }
  const inviteId = body && typeof body === 'object' ? (body as { inviteId?: unknown }).inviteId : null
  if (typeof inviteId !== 'string' || !UUID_PATTERN.test(inviteId)) {
    return json(req, 400, { error: 'Choose an invite to email.' })
  }

  const inviteResult = await supabase
    .from('invites')
    .select('id, email, token, team_id, status, expires_at, role_intended')
    .eq('id', inviteId)
    .maybeSingle()
  if (inviteResult.error) return json(req, 500, { error: SEND_FAILED })

  const invite = inviteResult.data
  if (!invite || invite.status !== 'pending' || invite.role_intended !== 'player') {
    return json(req, 404, { error: 'That invite is no longer pending.' })
  }
  if (typeof invite.email !== 'string' || typeof invite.token !== 'string' || typeof invite.expires_at !== 'string') {
    return json(req, 500, { error: SEND_FAILED })
  }
  if (!/^[0-9a-f]{64}$/.test(invite.token)) return json(req, 500, { error: SEND_FAILED })
  if (new Date(invite.expires_at).getTime() <= Date.now()) {
    return json(req, 410, { error: 'This invite has expired. Create a new one.' })
  }

  let teamName: string | null = null
  if (typeof invite.team_id === 'string') {
    const teamResult = await supabase.from('teams').select('name').eq('id', invite.team_id).maybeSingle()
    if (!teamResult.error && typeof teamResult.data?.name === 'string') teamName = teamResult.data.name
  }

  const settings = smtpSettings()
  if (!settings) return json(req, 503, { error: NOT_CONFIGURED })

  try {
    await sendClubMail(
      { email: invite.email, token: invite.token, expiresAt: invite.expires_at, teamName },
      settings,
    )
  } catch (error) {
    logSendFailure(error, settings.pass)
    return json(req, 502, { error: SEND_FAILED })
  }

  return json(req, 200, { ok: true })
})
