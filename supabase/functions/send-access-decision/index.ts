import { notifyRequester } from '../_shared/access_notify.ts'
import { adminClient, json, readBody } from '../_shared/invite.ts'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

  const requestId = body && typeof body === 'object' ? (body as { requestId?: unknown }).requestId : null
  if (typeof requestId !== 'string' || !UUID_PATTERN.test(requestId)) {
    return json(req, 400, { error: 'Choose a request to finish.' })
  }

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Signup is not configured.' })
  const jwt = bearer(req)
  if (!jwt) return json(req, 401, { error: 'Sign in again.' })
  const authed = await admin.auth.getUser(jwt)
  const user = authed.data.user
  if (authed.error || !user) return json(req, 401, { error: 'Sign in again.' })

  const notice = await notifyRequester(admin, requestId, user.id)
  if (notice.missing) return json(req, 404, { error: 'That request is not yours to finish.' })
  return json(req, 200, { ok: true, mailed: notice.mailed })
})
