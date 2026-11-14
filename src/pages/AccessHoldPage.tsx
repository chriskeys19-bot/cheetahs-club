import { useEffect, useState } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { Crest } from '../components/Crest.tsx'
import { loadMyAccessRequest, remindApprovers, type MyAccessRequest } from '../lib/access.ts'
import { formatWhen } from '../lib/format.ts'

export function AccessHoldPage() {
  const { session, reloadProfile, signOut } = useAuth()
  const userId = session?.user.id ?? null
  const [request, setRequest] = useState<MyAccessRequest | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    loadMyAccessRequest(userId).then(({ request: next, error: nextError }) => {
      if (cancelled) return
      setRequest(next)
      setError(nextError)
      setReady(true)
    })
    void remindApprovers()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      void reloadProfile()
    }, 15000)
    const onFocus = () => {
      void reloadProfile()
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [reloadProfile])

  async function onSignOut() {
    setBusy(true)
    setError(null)
    try {
      await signOut()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not sign out.')
      setBusy(false)
    }
  }

  const rejected = request?.status === 'rejected'
  const sides = request?.teamNames.length ? request.teamNames.join(', ') : null

  return (
    <div className="login-screen">
      <section className="login-hero">
        <Crest width={200} alt="Cheetahs Cricket Club crest" />
        <div>
          <p className="hero-kicker">{rejected ? 'Request declined' : 'Request pending'}</p>
          <h1>Cheetahs Cricket Club</h1>
          <p className="hero-copy">
            {rejected
              ? 'A captain reviewed your request and is not able to approve it yet.'
              : 'Your request is with the captains. The clubhouse stays closed until they approve it.'}
          </p>
        </div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <h2>{rejected ? 'Not approved' : 'Waiting for a captain'}</h2>
          {!ready ? <p className="fine-print">Checking your request…</p> : null}
          {ready && !request ? (
            <p>
              This account is not on a side yet. Ask a captain for a join link, or sign out and use
              the public sign-up link to choose a side.
            </p>
          ) : null}
          {request && !rejected ? (
            <>
              <p>
                {sides ? `You asked to join ${sides}.` : 'You asked to join the club.'} Sent{' '}
                {formatWhen(request.createdAt)}.
              </p>
              {request.note ? <p className="fine-print">Your note: {request.note}</p> : null}
              <p className="fine-print">
                You will get an email when a captain decides. This page opens the clubhouse on its
                own if they approve you while it is open.
              </p>
            </>
          ) : null}
          {rejected ? (
            <p className="fine-print">
              If this was a surprise, reply to the club email and a captain can take another look.
            </p>
          ) : null}
          {error ? (
            <p className="banner banner-error" role="alert">
              {error}
            </p>
          ) : null}
          <button type="button" className="button button-gold button-block" onClick={() => void onSignOut()} disabled={busy}>
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </section>
    </div>
  )
}
