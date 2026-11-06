import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useAuth } from '../auth/useAuth.ts'
import {
  FEEDBACK_CATEGORIES,
  MAX_FEEDBACK_TEXT,
  feedbackLengthMessage,
  submitFeedback,
  type FeedbackCategory,
} from '../lib/feedback.ts'
import { displayName } from '../lib/types.ts'

const SAVED: Record<FeedbackCategory, string> = {
  feature: 'Feature request saved.',
  bug: 'Bug report saved.',
  other: 'Feedback saved.',
}

export function FeedbackComposer({ onSubmitted }: { onSubmitted: () => void }) {
  const { session, profile, accountProfile } = useAuth()
  const bodyId = useId()
  const categoryName = useId()
  const statusRef = useRef<HTMLDivElement>(null)
  const sending = useRef(false)
  const [category, setCategory] = useState<FeedbackCategory>('feature')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!session) return null
  const user = session.user

  const trimmed = body.trim()
  const remaining = MAX_FEEDBACK_TEXT - body.length

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (trimmed.length < 1 || trimmed.length > MAX_FEEDBACK_TEXT) {
      setConfirmation(null)
      setError(feedbackLengthMessage())
      return
    }

    sending.current = true
    setBusy(true)
    setError(null)

    const message = await submitFeedback({
      userId: user.id,
      name: displayName(profile, user.email),
      email: user.email ?? null,
      role: accountProfile?.role ?? profile?.role ?? 'player',
      category,
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
    setConfirmation(SAVED[category])
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
    <form className="composer" aria-label="Feature request or feedback" onSubmit={onSubmit}>
      <fieldset className="category-set">
        <legend>Category</legend>
        <div className="category-row">
          {FEEDBACK_CATEGORIES.map((item) => (
            <label key={item.id} className="category-chip">
              <input
                type="radio"
                name={categoryName}
                value={item.id}
                checked={category === item.id}
                onChange={() => {
                  setCategory(item.id)
                  if (confirmation) setConfirmation(null)
                }}
              />
              {item.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor={bodyId}>Request</label>
      <textarea
        id={bodyId}
        name="feedback"
        value={body}
        onChange={(event) => {
          setBody(event.target.value)
          if (confirmation) setConfirmation(null)
        }}
        onKeyDown={onKeyDown}
        maxLength={MAX_FEEDBACK_TEXT}
        rows={4}
        required
        placeholder="A feature you want, or something in the app that should change."
      />
      <p className="fine-print">Your name and role are saved with it.</p>
      <div className="composer-row">
        <p className={remaining < 0 ? 'count count-over' : 'count'}>
          {body.length} / {MAX_FEEDBACK_TEXT}
        </p>
        <button type="submit" className="button button-gold" disabled={busy || trimmed.length < 1}>
          {busy ? 'Sending…' : 'Send feedback'}
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
