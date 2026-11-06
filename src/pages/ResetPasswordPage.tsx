import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { Splash } from '../components/Splash.tsx'
import { passwordProblem, passwordUpdateMessage, recoveryMessage, verifyRecoveryHash } from '../lib/passwordReset.ts'
import { establishRecoverySession, recoveryBoot, supabase } from '../lib/supabase.ts'

const bootError = recoveryBoot.error ? recoveryMessage(recoveryBoot.error) : null

export function ResetPasswordPage() {
  const { authReady, session, passwordRecovery } = useAuth()
  const [hashReady, setHashReady] = useState(recoveryBoot.tokenHash === null)
  const [sessionReady, setSessionReady] = useState(!recoveryBoot.hadAccessToken)
  const [hashError, setHashError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)

  useEffect(() => {
    if (!recoveryBoot.hadAccessToken || !supabase) return
    const client = supabase
    let cancelled = false
    establishRecoverySession(client).then((message) => {
      if (cancelled) return
      if (message) setHashError(recoveryMessage(message))
      setSessionReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const pending = verifyRecoveryHash()
    if (!pending) return
    let cancelled = false
    pending.then((message) => {
      if (cancelled) return
      setHashError(message)
      setHashReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!authReady || !hashReady) return
    if (!window.location.hash && !window.location.search) return
    window.history.replaceState(window.history.state, '', '/reset-password')
  }, [authReady, hashReady])

  if (!authReady || !hashReady || !sessionReady) return <Splash label="Checking this reset link…" />

  const problem = bootError ?? hashError
  if (passwordRecovery && !problem && !showForm) setShowForm(true)
  if (showForm && !problem) return <ChoosePassword />
  if (recoveryBoot.recovery || problem) {
    return (
      <ResetFrame
        kicker="Reset"
        title="Set a new password"
        copy="This reset link cannot be used."
      >
        <div className="login-card">
        <h2>Link unavailable</h2>
        <p className="banner banner-error" role="alert">
          {problem ?? 'This reset link is invalid or has expired. Ask an admin for a new one.'}
        </p>
        <p className="fine-print">
          <Link to="/login">Back to sign in</Link>
        </p>
        </div>
      </ResetFrame>
    )
  }

  return (
    <ResetFrame
      kicker="Reset"
      title="Set a new password"
      copy="Use the link from your email, or the one an admin sent you."
    >
      <div className="login-card">
      <h2>Open your reset link</h2>
      <p>This page is where a recovery link lands. It does not email a reset by itself.</p>
      <p className="fine-print">
        {session ? <Link to="/">Back to the clubhouse</Link> : <Link to="/login">Back to sign in</Link>}
      </p>
      </div>
    </ResetFrame>
  )
}

function ChoosePassword() {
  const { acknowledgeRecovery } = useAuth()
  const passwordId = useId()
  const confirmId = useId()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || saved) return
    const problem = passwordProblem(password, confirm)
    if (problem) {
      setError(problem)
      return
    }
    if (!supabase) {
      setError('Supabase is not configured.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (updateError) {
      setError(passwordUpdateMessage(updateError.message))
      return
    }
    setSaved(true)
    setPassword('')
    setConfirm('')
    acknowledgeRecovery()
  }

  return (
    <ResetFrame
      kicker="Reset"
      title="Set a new password"
      copy="Choose a password for your Cheetahs account. You will stay signed in."
    >
      <form className="login-card" onSubmit={onSubmit}>
        <h2>Set new password</h2>
        {saved ? (
          <div className="banner banner-success" role="status">
            <p className="banner-title">Password saved</p>
            <p>Your new password is ready. Use it the next time you sign in.</p>
          </div>
        ) : (
          <>
            <label htmlFor={passwordId}>New password</label>
            <input
              id={passwordId}
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
            <label htmlFor={confirmId}>Confirm password</label>
            <input
              id={confirmId}
              name="confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              minLength={8}
              maxLength={72}
              required
            />
            <p className="fine-print">Use 8 to 72 characters.</p>
          </>
        )}
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <Link to="/" className="button button-gold button-block">
            Enter the clubhouse
          </Link>
        ) : (
          <button type="submit" className="button button-gold button-block" disabled={busy}>
            {busy ? 'Saving…' : 'Save password'}
          </button>
        )}
      </form>
    </ResetFrame>
  )
}

function ResetFrame({
  kicker,
  title,
  copy,
  children,
}: {
  kicker: string
  title: string
  copy: string
  children: ReactNode
}) {
  return (
    <div className="login-screen">
      <section className="login-hero">
        <img src="/crest.jpg" alt="Cheetahs Cricket Club crest" width={168} height={168} />
        <div>
          <p className="hero-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="hero-copy">{copy}</p>
        </div>
      </section>
      <section className="login-panel">{children}</section>
    </div>
  )
}
