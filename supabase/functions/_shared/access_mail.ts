import nodemailer from 'npm:nodemailer@6.10.1'
import { headerSafe, type ClubMessage } from './access_request.ts'

// Same Gmail mailbox as send-invite-email. Supabase Edge blocks ports 25 and
// 587, so this uses 465. Secrets, never source: INVITE_SMTP_USER,
// INVITE_SMTP_PASS, optional INVITE_FROM_NAME, optional APP_ORIGIN.

const CLUB_MAILBOX = 'cheetahscc123@gmail.com'
const DEFAULT_FROM_NAME = 'Cheetahs Cricket Club'
const DEFAULT_ORIGIN = 'https://cheetahs-club.pages.dev'

const ALLOWED_ORIGINS = new Set([
  'https://cheetahs-club.pages.dev',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
])

export type SmtpSettings = {
  user: string
  pass: string
  fromName: string
}

type MailTransport = {
  sendMail: (message: Record<string, unknown>) => Promise<unknown>
}

export function appOrigin(): string {
  const raw = headerSafe(Deno.env.get('APP_ORIGIN') ?? DEFAULT_ORIGIN)
  if (ALLOWED_ORIGINS.has(raw)) return raw
  return DEFAULT_ORIGIN
}

export function smtpSettings(): SmtpSettings | null {
  const user = (Deno.env.get('INVITE_SMTP_USER') ?? '').trim().toLowerCase()
  const pass = (Deno.env.get('INVITE_SMTP_PASS') ?? '').replace(/\s+/g, '')
  const fromName = headerSafe(Deno.env.get('INVITE_FROM_NAME') ?? DEFAULT_FROM_NAME) || DEFAULT_FROM_NAME
  if (user !== CLUB_MAILBOX || pass.length < 8) return null
  return { user, pass, fromName }
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

export function logMailFailure(error: unknown, pass: string): void {
  const raw = error instanceof Error ? error.message : 'send failed'
  const clean = pass ? raw.split(pass).join('[redacted]') : raw
  console.error('access email send failed', clean.slice(0, 300))
}

export async function sendClubMessages(
  settings: SmtpSettings,
  messages: { to: string; message: ClubMessage }[],
): Promise<{ sent: number; failed: number }> {
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: settings.user, pass: settings.pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  })
  let sent = 0
  let failed = 0
  for (const item of messages) {
    const to = headerSafe(item.to).toLowerCase()
    if (!to.includes('@')) {
      failed += 1
      continue
    }
    try {
      await transport.sendMail({
        from: { name: settings.fromName, address: CLUB_MAILBOX },
        to,
        replyTo: CLUB_MAILBOX,
        subject: headerSafe(item.message.subject),
        text: item.message.text,
        html: item.message.html,
      })
      sent += 1
    } catch (error) {
      failed += 1
      logMailFailure(error, settings.pass)
    }
  }
  return { sent, failed }
}
