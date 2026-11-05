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
  const [email, setEmail] = useState('')
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
        <img src="/crest.jpg" alt="Cheetah Cricket Club crest" width={168} height={168} />
        <div>
          <p className="hero-kicker">Members</p>
          <h1>Cheetah Cricket Club</h1>
          <p className="hero-copy">Sign in for announcements, fixtures, polls, and the suggestion box.</p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <h2>Sign in</h2>
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
          <p className="fine-print">Use the email and password from your club account.</p>
        </form>
      </section>
    </div>
  )
}
