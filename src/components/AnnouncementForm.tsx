import { useRef, useState, type FormEvent } from 'react'
import { RichTextField } from './RichTextField.tsx'
import { saveAnnouncement } from '../lib/announcements.ts'
import { visibleTextLength } from '../lib/richText.ts'
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
  const sending = useRef(false)
  const [draft, setDraft] = useState(0)
  const [title, setTitle] = useState(initial?.title ?? '')
  const [titleLength, setTitleLength] = useState(() => visibleTextLength(initial?.title ?? ''))
  const [body, setBody] = useState(initial?.body ?? '')
  const [bodyLength, setBodyLength] = useState(() => visibleTextLength(initial?.body ?? ''))
  const [pinned, setPinned] = useState(initial?.pinned ?? false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (sending.current) return
    if (titleLength < 1 || titleLength > 140 || bodyLength < 1 || bodyLength > 4000) {
      setError('Use a title up to 140 characters and a note up to 4000.')
      return
    }
    if (title.length > 4000 || body.length > 30000) {
      setError('That formatting is too long. Shorten the note.')
      return
    }
    sending.current = true
    setBusy(true)
    setError(null)
    const message = await saveAnnouncement({
      id: initial?.id,
      title,
      body,
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
      setTitleLength(0)
      setBody('')
      setBodyLength(0)
      setPinned(false)
      setDraft((value) => value + 1)
    }
    onSaved()
  }

  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="section-heading">
        <p className="kicker">{initial ? 'Edit' : 'New'}</p>
        <h2>{initial ? 'Update this note' : 'Post an announcement'}</h2>
      </div>
      <RichTextField
        key={`title-${initial?.id ?? 'new'}-${draft}`}
        label="Title"
        initial={draft > 0 ? '' : (initial?.title ?? '')}
        compact
        required
        onChange={(stored, length) => {
          setTitle(stored)
          setTitleLength(length)
        }}
      />
      <RichTextField
        key={`body-${initial?.id ?? 'new'}-${draft}`}
        label="Message"
        initial={draft > 0 ? '' : (initial?.body ?? '')}
        required
        onChange={(stored, length) => {
          setBody(stored)
          setBodyLength(length)
        }}
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
        <button type="submit" className="button button-gold" disabled={busy || titleLength < 1 || bodyLength < 1}>
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
