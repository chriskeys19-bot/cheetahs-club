import { useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { Splash } from '../components/Splash.tsx'

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/'
  if (!value.startsWith('/') || value.startsWith('//') || value === '/login') return '/'
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
  const { session, authReady, signIn } = useAuth()
  const location = useLocation()
  const state = location.state as { from?: unknown; joined?: unknown; email?: unknown } | null
  const joined = state?.joined === true
  const [email, setEmail] = useState(typeof state?.email === 'string' ? state.email : '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!authReady) return <Splash label="Opening the clubhouse…" />
  if (session) {
    const state = location.state as { from?: unknown } | null
    return <Navigate to={safeNext(state?.from)} replace />
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const message = await signIn(email, password)
    if (message) {
      setError(loginMessage(message))
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <section className="login-hero">
        <img src="/crest.jpg" alt="Cheetahs Cricket Club crest" width={168} height={168} />
        <div>
          <p className="hero-kicker">Members</p>
          <h1>Cheetahs Cricket Club</h1>
          <p className="hero-copy">Sign in for announcements, fixtures, polls, and app feedback.</p>
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
          <button type="submit" className="button button-gold button-block" disabled={busy}>
            {busy ? 'Signing in…' : 'Enter the clubhouse'}
          </button>
          <p className="fine-print">
            Club accounts are invite-only. A captain or admin sends you a join link. There is no
            public sign-up.
          </p>
        </form>
      </section>
    </div>
  )
}
