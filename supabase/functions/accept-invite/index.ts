import { adminClient, json, loadInvite, readBody, tokenFrom } from '../_shared/invite.ts'

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  if (name.length < 1 || name.length > 80) return null
  for (let index = 0; index < name.length; index += 1) {
    if (name.charCodeAt(index) < 32) return null
  }
  return name
}

function passwordProblem(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 8 || value.length > 72) {
    return 'Use a password of 8 to 72 characters.'
  }
  return null
}

function safeAuthMessage(message: string, password: string): string {
  if (message.includes(password)) return 'Choose a different password.'
  const lower = message.toLowerCase()
  if (lower.includes('already') || lower.includes('registered') || lower.includes('exists')) {
    return 'That email already has a club account. Sign in instead.'
  }
  if (lower.includes('password')) return 'Choose a password of 8 to 72 characters.'
  return 'The account could not be created. Try again in a moment.'
}

Deno.serve(async (req: Request) => {
  const body = await readBody(req)
  if (body instanceof Response) return body

  const token = tokenFrom(body)
  if (!token) return json(req, 404, { error: 'This join link is not valid.' })

  const record = body as Record<string, unknown>
  const fullName = cleanName(record.full_name)
  if (!fullName) return json(req, 400, { error: 'Enter your full name.' })
  const password = record.password
  const passwordError = passwordProblem(password)
  if (passwordError || typeof password !== 'string') {
    return json(req, 400, { error: passwordError ?? 'Use a password of 8 to 72 characters.' })
  }

  const admin = adminClient()
  if (!admin) return json(req, 500, { error: 'Invite signup is not configured.' })

  const loaded = await loadInvite(req, admin, token)
  if ('error' in loaded) return loaded.error
  const invite = loaded.invite

  const created = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })

  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'The account could not be created.'
    const status = message.toLowerCase().includes('already') ? 409 : 400
    return json(req, status, { error: safeAuthMessage(message, password) })
  }

  const user = created.data.user
  if (!user.email || user.email.toLowerCase() !== invite.email.toLowerCase()) {
    await admin.auth.admin.deleteUser(user.id)
    return json(req, 500, { error: 'The account could not be created. Try again in a moment.' })
  }

  const profileWrite = await admin
    .from('profiles')
    .update({ full_name: fullName, role: 'player' })
    .eq('id', user.id)
    .select('role')
    .maybeSingle()

  if (profileWrite.error || profileWrite.data?.role !== 'player') {
    console.error('player profile was not saved', invite.id)
    await admin.auth.admin.deleteUser(user.id)
    return json(req, 500, { error: 'The account could not be created. Try again in a moment.' })
  }

  const accepted = await admin
    .from('invites')
    .update({
      status: 'accepted',
      accepted_user_id: user.id,
      accepted_at: new Date().toISOString(),
    })
    .eq('id', invite.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle()

  if (accepted.error || !accepted.data) {
    console.error('invite accept failed', invite.id)
    await admin.auth.admin.deleteUser(user.id)
    return json(req, 409, { error: 'This invite has already been used. Sign in instead.' })
  }

  let teamAssigned = false
  if (invite.team_id) {
    const membership = await admin.from('team_members').insert({
      team_id: invite.team_id,
      profile_id: user.id,
    })
    if (membership.error) {
      console.error('team assign failed', invite.id)
    } else {
      teamAssigned = true
    }
  }

  return json(req, 200, { ok: true, teamAssigned })
})
