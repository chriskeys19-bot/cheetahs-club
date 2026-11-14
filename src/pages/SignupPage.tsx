import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, Navigate } from 'react-router'
import { useAuth } from '../auth/useAuth.ts'
import { GoogleSignInButton } from '../components/GoogleSignInButton.tsx'
import { Crest } from '../components/Crest.tsx'
import { Splash } from '../components/Splash.tsx'
import { requestAccess } from '../lib/access.ts'
import { clearInviteToken, rememberSignup, startGoogleSignIn } from '../lib/googleAuth.ts'
import { loadTeams } from '../lib/teams.ts'
import type { Team } from '../lib/types.ts'

export function SignupPage() {
  const { session, authReady, googleGateReady, signIn } = useAuth()
  const nameId = useId()
  const emailId = useId()
  const passwordId = useId()
  const confirmId = useId()
  const noteId = useId()
  const [teams, setTeams] = useState<Team[] | null>(null)
  const [teamError, setTeamError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadTeams().then(({ teams: next, error: nextError }) => {
      if (cancelled) return
      setTeams(next)
      setTeamError(nextError)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!authReady || (session && !googleGateReady)) return <Splash label="Opening the clubhouse…" />
  if (session) return <Navigate to="/" replace />

  function toggleTeam(teamId: string) {
    setSelected((current) => (current.includes(teamId) ? current.filter((id) => id !== teamId) : [...current, teamId]))
  }

  function chosenName(): string | null {
    const name = fullName.trim().replace(/\s+/g, ' ')
    if (name.length < 1 || name.length > 80) return null
    return name
  }

  async function onGoogle() {
    if (busy || googleBusy) return
    if (selected.length < 1) {
      setError('Choose at least one side.')
      return
    }
    const name = chosenName()
    if (!name) {
      setError('Enter your full name.')
      return
    }
    setGoogleBusy(true)
    setError(null)
    clearInviteToken()
    rememberSignup({ teamIds: selected, note: note.trim(), fullName: name })
    const message = await startGoogleSignIn(null)
    if (message) {
      setError(message)
      setGoogleBusy(false)
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || googleBusy) return
    const name = chosenName()
    if (!name) {
      setError('Enter your full name.')
      return
    }
    const nextEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nextEmail)) {
      setError('Enter a valid email address.')
      return
    }
    if (password.length < 8 || password.length > 72) {
      setError('Use a password of 8 to 72 characters.')
      return
    }
    if (password !== confirm) {
      setError('Those passwords do not match.')
      return
    }
    if (selected.length < 1) {
      setError('Choose at least one side.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await requestAccess({
      email: nextEmail,
      fullName: name,
      password,
      teamIds: selected,
      note: note.trim(),
    })
    if (result.error) {
      setError(result.error)
      setBusy(false)
      return
    }
    const signInError = await signIn(nextEmail, password)
    if (signInError) {
      setError('Your request is saved. Sign in with that email and password to see it.')
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <section className="login-hero">
        <Crest width={200} alt="Cheetahs Cricket Club crest" />
        <div>
          <p className="hero-kicker">Request access</p>
          <h1>Cheetahs Cricket Club</h1>
          <p className="hero-copy">
            Tell us who you are and which side you want to join. A captain approves the request
            before you can see the clubhouse.
          </p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
          <h2>Ask to join</h2>
          {teamError ? (
            <p className="banner banner-error" role="alert">
              {teamError}
            </p>
          ) : null}
          <fieldset className="choice-list">
            <legend>Sides</legend>
            {teams === null ? <p className="fine-print">Loading sides…</p> : null}
            {teams && teams.length === 0 ? <p className="fine-print">No sides are listed yet.</p> : null}
            {teams?.map((team) => (
              <label key={team.id} className="choice">
                <input
                  type="checkbox"
                  name="teams"
                  value={team.id}
                  checked={selected.includes(team.id)}
                  onChange={() => toggleTeam(team.id)}
                />
                <span>{team.name}</span>
              </label>
            ))}
          </fieldset>
          <label htmlFor={nameId}>Full name</label>
          <input
            id={nameId}
            name="fullName"
            autoComplete="name"
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            maxLength={80}
            required
          />
          <label htmlFor={noteId}>Note</label>
          <textarea
            id={noteId}
            name="note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={500}
            placeholder="Optional. Experience, availability, or anything a captain should know."
          />
          <GoogleSignInButton busy={googleBusy} disabled={busy} onClick={() => void onGoogle()} />
          <div className="login-or">
            <span>or use email</span>
          </div>
          <label htmlFor={emailId}>Email</label>
          <input
            id={emailId}
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor={passwordId}>Password</label>
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
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="submit" className="button button-gold button-block" disabled={busy || googleBusy}>
            {busy ? 'Sending request…' : 'Request access'}
          </button>
          <p className="fine-print">
            Already have an account? <Link to="/login">Sign in</Link>
          </p>
        </form>
      </section>
    </div>
  )
}
