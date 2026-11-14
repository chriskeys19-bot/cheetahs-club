import { useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { GoogleSignInButton } from '../components/GoogleSignInButton.tsx'
import { Crest } from '../components/Crest.tsx'
import { Splash } from '../components/Splash.tsx'
import { clearOauthNotice, clearSignup, peekOauthNotice, startGoogleSignIn, type GoogleFinishResult } from '../lib/googleAuth.ts'

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value === '/login' || value === '/auth/callback') {
    return '/'
  }
  return value
}

function loginMessage(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'That email and password did not match.'
  }
  if (lower.includes('email not confirmed')) {
    return 'Confirm your email, then sign in again.'
  }
  return message
}

export function LoginPage() {
  const { session, authReady, googleGateReady, signIn, passwordRecovery } = useAuth()
  const location = useLocation()
  const state = location.state as { from?: unknown; joined?: unknown; email?: unknown } | null
  const joined = state?.joined === true
  const [email, setEmail] = useState(typeof state?.email === 'string' ? state.email : '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [noticeHidden, setNoticeHidden] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const notice = noticeHidden || session ? null : peekOauthNotice()

  if (!authReady || (session && !googleGateReady)) return <Splash label="Opening the clubhouse…" />
  if (session) {
    if (passwordRecovery) return <Navigate to="/reset-password" replace />
    const state = location.state as { from?: unknown } | null
    return <Navigate to={safeNext(state?.from)} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (googleBusy) return
    setBusy(true)
    setError(null)
    const message = await signIn(email, password)
    if (message) {
      setError(loginMessage(message))
      setBusy(false)
    }
  }

  async function onGoogle() {
    if (busy || googleBusy) return
    setGoogleBusy(true)
    setError(null)
    clearOauthNotice()
    clearSignup()
    setNoticeHidden(true)
    const message = await startGoogleSignIn(null)
    if (message) {
      setError(message)
      setGoogleBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <section className="login-hero">
        <Crest width={200} alt="Cheetahs Cricket Club crest" />
        <div>
          <p className="hero-kicker">Members</p>
          <h1>Cheetahs Cricket Club</h1>
          <p className="hero-copy">Sign in with Google or with the email and password for your club account.</p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <h2>Sign in</h2>
          {joined ? (
            <div className="banner banner-success" role="status">
              <p className="banner-title">Account ready</p>
              <p>Your player account is ready. Sign in with the password you just chose.</p>
            </div>
          ) : null}
          {notice ? (
            <OauthNotice
              notice={notice}
              onDismiss={() => {
                clearOauthNotice()
                setNoticeHidden(true)
              }}
            />
          ) : null}
          <GoogleSignInButton busy={googleBusy} disabled={busy} onClick={() => void onGoogle()} />
          <div className="login-or">
            <span>or</span>
          </div>
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="button button-gold button-block" disabled={busy || googleBusy}>
            {busy ? 'Signing in…' : 'Enter the clubhouse'}
          </button>
          <p className="fine-print">
            New to the club? <Link to="/signup">Request access</Link>. A captain approves it before
            you can see the clubhouse. Already invited? Open the join link they sent you.
          </p>
        </form>
      </section>
    </div>
  )
}

function OauthNotice({ notice, onDismiss }: { notice: GoogleFinishResult; onDismiss: () => void }) {
  if (notice.status === 'invite_required') {
    return (
      <div className="banner banner-note" role="status">
        <p className="banner-title">Ask your captain for an invite</p>
        <p>
          Google signed you in, but this address is not on the club roster yet. Request access
          from the sign-up page, or open the join link a captain sent you.
        </p>
        <p className="fine-print">
          <button type="button" className="text-button" onClick={onDismiss}>
            Dismiss
          </button>
        </p>
      </div>
    )
  }
  return (
    <p className="banner banner-error" role="alert">
      {notice.message ?? 'Google sign-in could not be finished. Try again.'}{' '}
      <button type="button" className="text-button" onClick={onDismiss}>
        Dismiss
      </button>
    </p>
  )
}
