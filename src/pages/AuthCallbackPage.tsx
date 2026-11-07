import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { Crest } from '../components/Crest.tsx'
import { Splash } from '../components/Splash.tsx'
import {
  clearInviteToken,
  finishGoogleSignIn,
  googleRedirectError,
  readInviteToken,
  type GoogleFinishResult,
} from '../lib/googleAuth.ts'
import { supabase } from '../lib/supabase.ts'

type View =
  | { kind: 'working' }
  | { kind: 'invite' }
  | { kind: 'mismatch'; token: string | null }
  | { kind: 'unusable'; message: string }
  | { kind: 'error'; message: string }

export function AuthCallbackPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>({ kind: 'working' })

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let cancelled = false

    async function finish(token: string | null) {
      const result = await finishGoogleSignIn(token)
      if (cancelled) return
      clearInviteToken()
      if (result.status === 'member' || result.status === 'joined') {
        navigate('/', { replace: true })
        return
      }
      await client.auth.signOut()
      if (cancelled) return
      setView(viewForResult(result, token))
    }

    async function run() {
      const params = new URLSearchParams(window.location.search)
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
      const oauthError = params.get('error_description') || params.get('error') || hash.get('error_description') || hash.get('error')
      const token = readInviteToken()
      if (oauthError) {
        clearInviteToken()
        if (!cancelled) setView({ kind: 'error', message: googleRedirectError(oauthError) })
        return
      }

      const code = params.get('code')
      if (code) {
        const exchanged = await client.auth.exchangeCodeForSession(code)
        window.history.replaceState({}, '', '/auth/callback')
        if (exchanged.error) {
          const { data } = await client.auth.getSession()
          if (!data.session) {
            clearInviteToken()
            if (!cancelled) {
              setView({ kind: 'error', message: 'Google sign-in could not be finished. Try again.' })
            }
            return
          }
        }
      } else {
        const { data } = await client.auth.getSession()
        if (!data.session) {
          clearInviteToken()
          if (!cancelled) {
            setView({ kind: 'error', message: 'Google did not return a sign-in code. Try again.' })
          }
          return
        }
      }

      await finish(token)
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [navigate])

  if (view.kind === 'working') return <Splash label="Signing you in…" />
  if (view.kind === 'invite') {
    return (
      <CallbackShell kicker="Members" copy="Club accounts are invite-only.">
        <h2>Ask your captain for an invite</h2>
        <p>
          Google signed you in, but that does not open the clubhouse. A captain or admin sends a
          join link. Open that link and choose Continue with Google with the same email address.
        </p>
        <p className="fine-print">
          <Link to="/login">Back to sign in</Link>
        </p>
      </CallbackShell>
    )
  }
  if (view.kind === 'mismatch') {
    return (
      <CallbackShell kicker="Join" copy="The Google account has to match the invite.">
        <h2>Use the invited Google account</h2>
        <p>
          That Google account uses a different email than this invite. Open the join link again and
          choose the invited address, or set a password on that page instead.
        </p>
        <p className="fine-print">
          {view.token ? <Link to={`/join/${view.token}`}>Back to the join link</Link> : <Link to="/login">Back to sign in</Link>}
        </p>
      </CallbackShell>
    )
  }
  return (
    <CallbackShell kicker="Members" copy="Google sign-in stopped before the clubhouse opened.">
      <h2>{view.kind === 'unusable' ? 'Invite unavailable' : 'Try signing in again'}</h2>
      <p className="banner banner-error" role="alert">
        {view.message}
      </p>
      <p className="fine-print">
        <Link to="/login">Back to sign in</Link>
      </p>
    </CallbackShell>
  )
}

function viewForResult(result: GoogleFinishResult, token: string | null): View {
  if (result.status === 'email_mismatch') return { kind: 'mismatch', token }
  if (result.status === 'invite_unusable') {
    return { kind: 'unusable', message: result.message ?? 'This join link is not valid.' }
  }
  if (result.status === 'invite_required') return { kind: 'invite' }
  if (result.status === 'no_profile') {
    return {
      kind: 'error',
      message: result.message ?? 'This account is not on the club roster. Ask an admin to check it.',
    }
  }
  return {
    kind: 'error',
    message: result.message ?? 'Google sign-in could not be finished. Try again.',
  }
}

function CallbackShell({ kicker, copy, children }: { kicker: string; copy: string; children: ReactNode }) {
  return (
    <div className="login-screen">
      <section className="login-hero">
        <Crest width={200} alt="Cheetahs Cricket Club crest" />
        <div>
          <p className="hero-kicker">{kicker}</p>
          <h1>Cheetahs Cricket Club</h1>
          <p className="hero-copy">{copy}</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">{children}</div>
      </section>
    </div>
  )
}
