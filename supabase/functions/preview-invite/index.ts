import { adminClient, json, loadInvite, readBody, tokenFrom } from '../_shared/invite.ts'

Deno.serve(async (req: Request) => {
  const body = await readBody(req)
  if (body instanceof Response) return body

  const token = tokenFrom(body)
  if (!token) return json(req, 404, { error: 'This join link is not valid.' })

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Invite checks are not configured.' })

  const loaded = await loadInvite(req, admin, token)
  if ('error' in loaded) return loaded.error

  let teamName: string | null = null
  if (loaded.invite.team_id) {
    const { data, error } = await admin
      .from('teams')
      .select('name')
      .eq('id', loaded.invite.team_id)
      .maybeSingle()
    if (error) {
      console.error('invite team lookup failed', loaded.invite.id)
    } else if (data && typeof data.name === 'string') {
      teamName = data.name
    }
  }

  return json(req, 200, {
    email: loaded.invite.email,
    teamName,
    expiresAt: loaded.invite.expires_at,
  })
})
