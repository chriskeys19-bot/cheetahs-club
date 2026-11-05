import { useId, useRef, useState, type FormEvent } from 'react'
import { saveAnnouncement } from '../lib/announcements.ts'
import type { Announcement } from '../lib/types.ts'

export function AnnouncementForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial: Announcement | null
  onSaved: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const bodyId = useId()
  const sending = useRef(false)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [pinned, setPinned] = useState(initial?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    const nextTitle = title.trim()
    const nextBody = body.trim()
    if (nextTitle.length < 1 || nextTitle.length > 140 || nextBody.length < 1 || nextBody.length > 4000) {
      setError('Use a title up to 140 characters and a note up to 4000.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveAnnouncement({
      id: initial?.id,
      title: nextTitle,
      body: nextBody,
      pinned,
    })
    sending.current = false
    setBusy(false)
    if (message) {
      setError(message)
      return
    }
    if (!initial) {
      setTitle('')
      setBody('')
      setPinned(false)
    }
    onSaved()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">{initial ? 'Edit' : 'New'}</p>
        <h2>{initial ? 'Update this note' : 'Post an announcement'}</h2>
      </div>
      <label htmlFor={titleId}>Title</label>
      <input
        id={titleId}
        name="title"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        maxLength={140}
        required
      />
      <label htmlFor={bodyId}>Message</label>
      <textarea
        id={bodyId}
        name="body"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={4000}
        rows={5}
        required
      />
      <label className="check-row">
        <input
          type="checkbox"
          name="pinned"
          checked={pinned}
          onChange={(event) => setPinned(event.target.checked)}
        />
        Pin to the top
      </label>
      <div className="composer-row">
        {initial ? (
          <button type="button" className="button button-quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        ) : (
          <span />
        )}
        <button type="submit" className="button button-gold" disabled={busy || title.trim().length < 1}>
          {busy ? 'Saving…' : initial ? 'Save changes' : 'Post'}
        </button>
      </div>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  )
}
