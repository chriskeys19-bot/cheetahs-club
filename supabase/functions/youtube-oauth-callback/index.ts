import { redactForLog } from '../_shared/http.ts'
import { oauthSecrets, serviceClient } from '../_shared/club_user.ts'
import {
  broadcastsReturnUrl,
  readChannel,
  readOauthToken,
  verifyOauthState,
  youtubeRedirectUri,
} from '../_shared/youtube_oauth.ts'

// Google redirects the browser here with no Supabase JWT. verify_jwt must
// stay false. The request is accepted only when state is the signed,
// unexpired, single-use value created by youtube-oauth-start for an admin.

function redirectTo(result: { ok: true } | { ok: false; reason: string }): Response {
  return new Response(null, {
    status: 302,
    headers: {
      Location: broadcastsReturnUrl(result),
      'Cache-Control': 'no-store',
    },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'GET') return redirectTo({ ok: false, reason: 'exchange' })

  const url = new URL(req.url)
  const oauthError = url.searchParams.get('error')
  if (oauthError) return redirectTo({ ok: false, reason: oauthError === 'access_denied' ? 'denied' : 'exchange' })

  const code = url.searchParams.get('code')?.trim() ?? ''
  const state = url.searchParams.get('state')?.trim() ?? ''
  if (!code || code.length > 2048 || /\s/.test(code) || !state) {
    return redirectTo({ ok: false, reason: 'exchange' })
  }

  const secrets = oauthSecrets()
  const redirectUri = secrets ? youtubeRedirectUri(secrets.supabaseUrl) : null
  const admin = serviceClient()
  if (!secrets || !redirectUri || !admin) return redirectTo({ ok: false, reason: 'config' })

  const verified = await verifyOauthState(state, secrets.clientSecret)
  if (!verified) return redirectTo({ ok: false, reason: 'state' })

  const consumed = await admin.rpc('youtube_oauth_consume_state', { p_nonce_hash: verified.nonceHash })
  const consumedId = typeof consumed.data === 'string' ? consumed.data.toLowerCase() : ''
  if (consumed.error || !consumedId || consumedId !== verified.userId) {
    return redirectTo({ ok: false, reason: 'state' })
  }

  const profile = await admin.from('profiles').select('role, access_status').eq('id', consumedId).maybeSingle()
  const role = profile.data?.role
  const access = profile.data?.access_status
  if (profile.error || role !== 'admin' || access === 'pending') {
    return redirectTo({ ok: false, reason: 'forbidden' })
  }

  const body = new URLSearchParams({
    code,
    client_id: secrets.clientId,
    client_secret: secrets.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  })
  let tokenJson: unknown
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    tokenJson = await tokenResponse.json()
  } catch (error) {
    console.error('youtube token exchange failed', redactForLog(error instanceof Error ? error.message : 'fetch failed'))
    return redirectTo({ ok: false, reason: 'exchange' })
  }

  const token = readOauthToken(tokenJson)
  if (!token.ok || !token.refreshToken) {
    return redirectTo({ ok: false, reason: token.ok ? 'missing_refresh' : 'exchange' })
  }

  let channelJson: unknown
  try {
    const channelResponse = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${token.accessToken}` },
    })
    channelJson = await channelResponse.json()
    if (!channelResponse.ok) channelJson = null
  } catch (error) {
    console.error('youtube channel lookup failed', redactForLog(error instanceof Error ? error.message : 'fetch failed'))
    return redirectTo({ ok: false, reason: 'channel' })
  }

  const channel = readChannel(channelJson)
  if (!channel) return redirectTo({ ok: false, reason: 'channel' })

  const saved = await admin.rpc('youtube_connection_save', {
    p_refresh_token: token.refreshToken,
    p_channel_id: channel.id,
    p_channel_title: channel.title,
    p_connected_by: consumedId,
  })
  if (saved.error) return redirectTo({ ok: false, reason: 'exchange' })
  return redirectTo({ ok: true })
})
