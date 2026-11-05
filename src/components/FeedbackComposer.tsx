import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import { submitFeedback } from '../lib/feedback.ts'
import { displayName } from '../lib/types.ts'

const MAX_BODY = 2000

export function FeedbackComposer({ onSubmitted }: { onSubmitted: () => void }) {
  const { session, profile } = useAuth()
  const bodyId = useId()
  const statusRef = useRef<HTMLDivElement>(null)
  const sending = useRef(false)
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!session) return null
  const user = session.user

  const trimmed = body.trim()
  const remaining = MAX_BODY - body.length

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (trimmed.length < 1 || trimmed.length > MAX_BODY) {
      setConfirmation(null)
      setError('Write a suggestion between 1 and 2000 characters.')
      return
    }

    sending.current = true
    setBusy(true)
    setError(null)

    const message = await submitFeedback({
      userId: user.id,
      name: displayName(profile, user.email),
      email: user.email ?? null,
      role: profile?.role ?? 'player',
      body: trimmed,
    })

    sending.current = false
    setBusy(false)

    if (message) {
      setConfirmation(null)
      setError(message)
      return
    }

    setBody('')
    setConfirmation('The club has your suggestion.')
    onSubmitted()
    queueMicrotask(() => statusRef.current?.focus())
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">Suggestion box</p>
        <h2>Tell the club</h2>
      </div>
      <p className="lede">
        Players, captains, and admins use the same box. Your name, email, and role are stored with
        the note.
      </p>
      <label htmlFor={bodyId}>Suggestion</label>
      <textarea
        id={bodyId}
        name="suggestion"
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
          if (confirmation) setConfirmation(null)
        }}
        onKeyDown={onKeyDown}
        maxLength={MAX_BODY}
        rows={6}
        required
        placeholder="Nets, fixtures, kit, or anything the club should hear."
      />
      <div className="composer-row">
        <p className={remaining < 0 ? 'count count-over' : 'count'}>{body.length} / {MAX_BODY}</p>
        <button type="submit" className="button button-gold" disabled={busy || trimmed.length < 1}>
          {busy ? 'Sending…' : 'Send to the club'}
        </button>
      </div>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
      {confirmation ? (
        <div className="banner banner-success" role="status" tabIndex={-1} ref={statusRef}>
          <p className="banner-title">Received</p>
          <p>{confirmation}</p>
        </div>
      ) : null}
    </form>
  )
}
