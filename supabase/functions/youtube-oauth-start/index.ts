import { json } from '../_shared/http.ts'
import { oauthSecrets, requireStaff, serviceClient } from '../_shared/club_user.ts'
import { googleAuthorizeUrl, signOauthState, youtubeRedirectUri } from '../_shared/youtube_oauth.ts'

// Admin starts YouTube OAuth. verify_jwt stays on. The handler calls getUser
// and requires profiles.role = admin. The signed state is stored as a hash
// and returned only inside the Google authorize URL.

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: json(req, 204, {}).headers })
  if (req.method !== 'POST') return json(req, 405, { error: 'Use POST.' })

  const staff = await requireStaff(req)
  if ('error' in staff) return json(req, staff.status, { error: staff.error })
  if (!staff.caller.admin) return json(req, 403, { error: 'Only an admin can connect YouTube.' })

  const secrets = oauthSecrets()
  const redirectUri = secrets ? youtubeRedirectUri(secrets.supabaseUrl) : null
  if (!secrets || !redirectUri) {
    return json(req, 500, { error: 'YouTube OAuth is not configured yet.' })
  }

  const signed = await signOauthState({ userId: staff.caller.id, secret: secrets.clientSecret })
  if (!signed) return json(req, 500, { error: 'YouTube could not be connected. Try again.' })

  const admin = serviceClient()
  if (!admin) return json(req, 500, { error: 'YouTube could not be connected. Try again.' })
  const stored = await admin.rpc('youtube_oauth_put_state', {
    p_nonce_hash: signed.nonceHash,
    p_user_id: signed.userId,
    p_expires_at: signed.expiresAt,
  })
  if (stored.error) return json(req, 500, { error: 'YouTube could not be connected. Try again.' })

  const url = googleAuthorizeUrl({
    clientId: secrets.clientId,
    redirectUri,
    state: signed.state,
  })
  if (!url) return json(req, 500, { error: 'YouTube could not be connected. Try again.' })
  return json(req, 200, { url })
})
