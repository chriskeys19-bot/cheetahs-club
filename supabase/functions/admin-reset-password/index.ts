import { createClient } from 'npm:@supabase/supabase-js@2.81.1'
import nodemailer from 'npm:nodemailer@6.10.1'
import {
  ALLOWED_ORIGINS,
  CLUB_MAILBOX,
  DEFAULT_FROM_NAME,
  DEFAULT_ORIGIN,
  EMAIL_NOT_CONFIGURED,
  EMAIL_SEND_FAILED,
  UUID_PATTERN,
  buildResetMessage,
  headerSafe,
  linkFailure,
  resetRedirect,
  resolveAppOrigin,
  smtpConfigured,
  validateRecoveryLink,
} from './logic.ts'

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

function logSendFailure(error: unknown, pass: string): void {
  const raw = error instanceof Error ? error.message : 'send failed'
  const clean = pass ? raw.split(pass).join('[redacted]') : raw
  console.error('password reset email send failed', clean.slice(0, 300))
}

function readSendEmail(body: unknown): boolean | null {
  if (!body || typeof body !== 'object') return null
  const value = (body as { sendEmail?: unknown }).sendEmail
  return typeof value === 'boolean' ? value : null
}

function readUserId(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const value = (body as { userId?: unknown }).userId
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) return null
  return value.toLowerCase()
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt || jwt.split('.').length !== 3) {
    return json(req, 401, { error: 'Sign in again, then reset the password.' })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(req, 500, { error: 'Password reset is not available right now.' })
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const userResult = await supabase.auth.getUser(jwt)
  const user = userResult.data.user
  if (userResult.error || !user) {
    return json(req, 401, { error: 'Sign in again, then reset the password.' })
  }

  const profileResult = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle()
  if (profileResult.error || profileResult.data?.role !== 'admin') {
    return json(req, 403, { error: 'Only an admin can reset a member password.' })
  }

  const text = await req.text()
  if (text.length > 2000) return json(req, 413, { error: 'Request is too large.' })
  let body: unknown
  try {
    body = JSON.parse(text) as unknown
  } catch {
    return json(req, 400, { error: 'Send JSON.' })
  }

  const userId = readUserId(body)
  const sendEmail = readSendEmail(body)
  if (!userId || sendEmail === null) {
    return json(req, 400, { error: 'Choose a member, then try the reset again.' })
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const memberResult = await admin.from('profiles').select('id, full_name').eq('id', userId).maybeSingle()
  if (memberResult.error) return json(req, 500, { error: 'The reset link could not be created. Try again.' })
  const member = memberResult.data
  if (!member || typeof member.id !== 'string') {
    return json(req, 404, { error: 'That member is no longer on the list.' })
  }

  const account = await admin.auth.admin.getUserById(userId)
  const email = account.data.user?.email?.trim() ?? ''
  if (account.error || !email) {
    return json(req, 404, { error: 'That member does not have an email on the account.' })
  }

  const origin = resolveAppOrigin(Deno.env.get('APP_ORIGIN') ?? undefined)
  const redirectTo = resetRedirect(origin)
  const generated = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo },
  })
  if (generated.error || !generated.data) {
    console.error('recovery link failed', generated.error?.code ?? 'unknown')
    return json(req, 502, { error: linkFailure(generated.error?.message ?? '') })
  }

  const properties = generated.data.properties
  const actionLink = properties && typeof properties.action_link === 'string' ? properties.action_link : ''
  const link = validateRecoveryLink(actionLink, supabaseUrl, redirectTo)
  if (!link) {
    console.error('recovery link was not a verify URL for the reset page')
    return json(req, 502, { error: 'The reset link could not be created. Try again.' })
  }

  let emailed = false
  let message: string | null = null
  if (sendEmail) {
    const settings = smtpConfigured(Deno.env.get('INVITE_SMTP_USER') ?? '', Deno.env.get('INVITE_SMTP_PASS') ?? '')
    if (!settings) {
      console.error('password reset email is not configured')
      message = EMAIL_NOT_CONFIGURED
    } else {
      const fromName = headerSafe(Deno.env.get('INVITE_FROM_NAME') ?? DEFAULT_FROM_NAME) || DEFAULT_FROM_NAME
      const fullName = typeof member.full_name === 'string' ? member.full_name : null
      const mail = buildResetMessage({ link, name: fullName, fromName })
      try {
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
          from: { name: fromName, address: CLUB_MAILBOX },
          to: email,
          replyTo: CLUB_MAILBOX,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        })
        emailed = true
      } catch (error) {
        logSendFailure(error, settings.pass)
        message = EMAIL_SEND_FAILED
      }
    }
  }

  const audit = await admin.from('password_reset_audit').insert({
    actor_id: user.id,
    target_id: userId,
    email_requested: sendEmail,
    emailed,
  })
  if (audit.error) console.error('password reset audit failed', audit.error.code)

  return json(req, 200, { ok: true, link, emailed, message })
})
