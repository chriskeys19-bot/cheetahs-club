import { notifyApprovers } from '../_shared/access_notify.ts'
import { adminClient, json, readBody } from '../_shared/invite.ts'

function bearer(req: Request): string | null {
  const header = req.headers.get('Authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  const token = match?.[1]?.trim() ?? ''
  if (!token || token.split('.').length < 3) return null
  return token
}

Deno.serve(async (req: Request) => {
  const body = await readBody(req)
  if (body instanceof Response) return body

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Signup is not configured.' })
  const jwt = bearer(req)
  if (!jwt) return json(req, 401, { error: 'Sign in again.' })
  const authed = await admin.auth.getUser(jwt)
  const user = authed.data.user
  if (authed.error || !user) return json(req, 401, { error: 'Sign in again.' })

  const pending = await admin
    .from('access_requests')
    .select('id')
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending.error) return json(req, 500, { error: 'The request could not be checked.' })
  const requestId =
    pending.data && typeof pending.data === 'object' && typeof (pending.data as { id?: unknown }).id === 'string'
      ? (pending.data as { id: string }).id
      : null
  if (!requestId) return json(req, 404, { error: 'There is no pending request to send.' })

  const notice = await notifyApprovers(admin, requestId)
  return json(req, 200, { ok: true, mailed: notice.mailed })
})
