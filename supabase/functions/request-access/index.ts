import { parseSignupInput } from '../_shared/access_request.ts'
import { notifyApprovers } from '../_shared/access_notify.ts'
import { adminClient, json, readBody } from '../_shared/invite.ts'

const HOUR_LIMIT = 30

function safeAuthMessage(message: string, password: string): string {
  if (message.includes(password)) return 'Choose a different password.'
  const lower = message.toLowerCase()
  if (lower.includes('already') || lower.includes('registered') || lower.includes('exists')) {
    return 'That email already has a club account. Sign in to see your request.'
  }
  if (lower.includes('password')) return 'Choose a password of 8 to 72 characters.'
  return 'The account could not be created. Try again in a moment.'
}

function requestIdFrom(value: unknown): { id: string; created: boolean } | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== 'object') return null
  const record = row as { id?: unknown; created?: unknown }
  if (typeof record.id !== 'string') return null
  return { id: record.id, created: record.created === true }
}

Deno.serve(async (req: Request) => {
  const body = await readBody(req)
  if (body instanceof Response) return body

  const parsed = parseSignupInput(body)
  if (!parsed.ok) return json(req, 400, { error: parsed.error })

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Signup is not configured.' })

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const recent = await admin
    .from('access_requests')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', since)
  if (recent.error) {
    const message = recent.error.message.toLowerCase()
    if (message.includes('access_requests') || message.includes('schema cache')) {
      return json(req, 503, { error: 'Access requests are not set up yet. Ask a captain for a join link.' })
    }
  } else if ((recent.count ?? 0) >= HOUR_LIMIT) {
    return json(req, 429, { error: 'Too many requests right now. Try again in a little while.' })
  }

  const created = await admin.auth.admin.createUser({
    email: parsed.value.email,
    password: parsed.value.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.value.fullName },
  })
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'The account could not be created.'
    const status = /already|registered|exists/i.test(message) ? 409 : 400
    return json(req, status, { error: safeAuthMessage(message, parsed.value.password) })
  }

  const user = created.data.user
  const recorded = await admin.rpc('create_access_request', {
    p_user_id: user.id,
    p_note: parsed.value.note,
    p_team_ids: parsed.value.teamIds,
  })
  const saved = requestIdFrom(recorded.data)
  if (recorded.error || !saved) {
    console.error('access request was not saved', recorded.error?.code ?? 'empty')
    await admin.auth.admin.deleteUser(user.id)
    const message = recorded.error?.message ?? ''
    if (/choose a side/i.test(message)) return json(req, 400, { error: 'Choose at least one side.' })
    if (/note is too long/i.test(message)) return json(req, 400, { error: 'Keep the note to 500 characters.' })
    if (/schema cache|create_access_request|does not exist/i.test(message)) {
      return json(req, 503, { error: 'Access requests are not set up yet. Ask a captain for a join link.' })
    }
    return json(req, 500, { error: 'The request could not be saved. Try again in a moment.' })
  }

  let mailed = false
  if (saved.created) {
    const notice = await notifyApprovers(admin, saved.id)
    mailed = notice.mailed
  }
  return json(req, 200, { ok: true, mailed })
})
