import { useEffect, useId, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { Splash } from '../components/Splash.tsx'
import { acceptInvite, previewInvite, type InvitePreview } from '../lib/invites.ts'
import { formatWhen } from '../lib/format.ts'

const TOKEN_PATTERN = /^[0-9a-f]{64}$/

export function JoinPage() {
  const { token: rawToken } = useParams()
  const navigate = useNavigate()
  const nameId = useId()
  const passwordId = useId()
  const confirmId = useId()
  const token = (rawToken ?? '').trim().toLowerCase()
  const tokenValid = TOKEN_PATTERN.test(token)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)
  const [loadedToken, setLoadedToken] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!tokenValid) return
    let cancelled = false
    previewInvite(token).then(({ preview: next, error: nextError }) => {
      if (cancelled) return
      setPreview(next)
      setLookupError(nextError)
      setLoadedToken(token)
    })
    return () => {
      cancelled = true
    }
  }, [token, tokenValid])

  if (!tokenValid) {
    return (
      <JoinUnavailable message="This join link is not valid." />
    )
  }

  if (loadedToken !== token) return <Splash label="Checking this invite…" />

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!preview || busy) return
    const name = fullName.trim().replace(/\s+/g, ' ')
    if (name.length < 1 || name.length > 80) {
      setError('Enter your full name.')
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
    setBusy(true)
    setError(null)
    const message = await acceptInvite({ token, fullName: name, password })
    if (message) {
      setError(message)
      setBusy(false)
      return
    }
    navigate('/login', { replace: true, state: { joined: true, email: preview.email } })
  }

  if (!preview) return <JoinUnavailable message={lookupError ?? 'This join link is not valid.'} />

  return (
    <div className="login-screen">
      <section className="login-hero">
        <img src="/crest.jpg" alt="Cheetah Cricket Club crest" width={168} height={168} />
        <div>
          <p className="hero-kicker">Join</p>
          <h1>Cheetah Cricket Club</h1>
          <p className="hero-copy">Set your name and password. You will join as a player.</p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={onSubmit}>
            <h2>Create your player account</h2>
            <p className="fine-print">
              {preview.teamName ? `Side: ${preview.teamName}. ` : null}
              Link expires {formatWhen(preview.expiresAt)}.
            </p>
            <label htmlFor="join-email">Email</label>
            <input id="join-email" name="email" type="email" value={preview.email} readOnly />
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
            <button type="submit" className="button button-gold button-block" disabled={busy}>
              {busy ? 'Creating account…' : 'Join as a player'}
            </button>
            <p className="fine-print">
              Already registered? <Link to="/login">Sign in</Link>
            </p>
          </form>
      </section>
    </div>
  )
}

function JoinUnavailable({ message }: { message: string }) {
  return (
    <div className="login-screen">
      <section className="login-hero">
        <img src="/crest.jpg" alt="Cheetah Cricket Club crest" width={168} height={168} />
        <div>
          <p className="hero-kicker">Join</p>
          <h1>Cheetah Cricket Club</h1>
          <p className="hero-copy">This join link cannot be used.</p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>Invite unavailable</h2>
          <p className="banner banner-error" role="alert">
            {message}
          </p>
          <p className="fine-print">
            <Link to="/login">Back to sign in</Link>
          </p>
        </div>
      </section>
    </div>
  )
}
